"""Source adapters. Uncertain facts become review items, never guessed data."""
import copy
import json
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from urllib.parse import quote, urljoin, urlsplit
from common import DataError, digest, finite, normalize_url, require, safe_url
from contract import CATEGORY_BY_EVENT, MODEL, PLAN, day, news_order, obj, text, unique


class Node:
    def __init__(self, tag='', attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

    def find(self, predicate):
        found = []
        for child in self.children:
            if isinstance(child, Node):
                if predicate(child):
                    found.append(child)
                found.extend(child.find(predicate))
        return found

    def text(self):
        if self.tag in ('script','style','svg','noscript'):
            return ''
        return ' '.join(c.text() if isinstance(c,Node) else c for c in self.children)


class Tree(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        n = Node(tag,attrs)
        self.stack[-1].children.append(n)
        if tag not in ('area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'):
            self.stack.append(n)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag,attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack)-1,0,-1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def plain(html):
    return ' '.join(Tree(html).root.text().split())


def decode(raw):
    return raw.decode('utf-8-sig', errors='strict')


def sponsored(card):
    """Paid sponsor slots link to /sponsors/<account>; they are not organic trending."""
    return bool(card.find(lambda n:'/sponsors/' in (n.attrs.get('href') or '')))


def parse_trending(html):
    articles = Tree(html).root.find(lambda n:n.tag=='article' and 'Box-row' in n.attrs.get('class','').split())
    require(articles,'Trending article structure missing')
    result=[]
    for rank,a in enumerate(articles,1):
        if sponsored(a):
            continue
        headings=a.find(lambda n:n.tag=='h2')
        links=headings[0].find(lambda n:n.tag=='a') if headings else []
        require(len(links)==1,'Trending heading changed')
        repo=links[0].attrs.get('href','').strip('/')
        require(re.fullmatch(r'[\w.-]+/[\w.-]+',repo),'Trending repo identity missing')
        stars=a.find(lambda n:n.tag=='a' and n.attrs.get('href')=='/'+repo+'/stargazers')
        require(len(stars)==1,'Trending star count missing')
        total=''.join(stars[0].text().split()).replace(',','')
        require(total.isdigit(),'Trending star count format changed')
        periods=re.findall(r'([\d,]+)\s+stars?\s+(?:this week|this month)',a.text())
        require(len(periods)<=1,'ambiguous Trending interval')
        descriptions=a.find(lambda n:n.tag=='p')
        languages=a.find(lambda n:n.attrs.get('itemprop')=='programmingLanguage')
        result.append(dict(repo=repo,sourceRank=rank,stars=int(total),periodStars=int(periods[0].replace(',','')) if periods else None,
                           language=' '.join(languages[0].text().split()) if languages else None,
                           description=' '.join(descriptions[0].text().split()) if descriptions else None,url='https://github.com/'+repo))
    require(result,'Trending page contains only sponsor slots')
    require(len({r['repo'] for r in result})==len(result),'duplicate Trending repo')
    return result


def is_ai(repo, overrides):
    decision=overrides.get(repo['repo'])
    if decision:
        require(decision in ('allow','exclude'),'unknown GitHub override')
        return decision=='allow'
    text=(repo['repo']+' '+(repo['description'] or '')).lower()
    if re.search(r'\b(awesome|tutorials?|course|curriculum|papers|collection of|list of)\b|教程|资源合集|提示词合集',text):
        return False
    if re.search(r'\b(llm|large language model|mcp|rag|ai[- ]powered|ai agent|ai coding|coding agent|agentic|local models?|inference engine|model context protocol)\b|大模型|智能体|人工智能',text):
        return True
    return None


def collect_github(client, now, languages, overrides, guard, review):
    """Global page plus admitted language pages; merged by repo, best page position wins."""
    result=dict(source='github-trending',dataUpdatedAt=now)
    for key,period in [('week','weekly'),('month','monthly')]:
        url='https://github.com/trending?since='+period
        merged={}; deadline=time.monotonic()+120
        for slug in ['']+languages:
            page=url if not slug else 'https://github.com/trending/'+quote(slug,safe='')+'?since='+period
            try:
                raw,final=client.get(page,deadline=deadline)
                require(normalize_url(final)==page,'Trending redirected unexpectedly')
                rows=parse_trending(decode(raw))
            except (DataError,ValueError) as exc:
                review('github-page',slug or 'global',str(exc),dict(sourceUrl=page))
                continue
            for row in rows:
                known=merged.get(row['repo'])
                if known is None or row['sourceRank']<known['sourceRank']:
                    merged[row['repo']]=row
        require(merged,'all Trending pages failed')
        guard('github-'+period,len(merged))
        order=lambda r:(r['periodStars'] is None,-(r['periodStars'] or 0),r['repo'])
        decisions=[(row,is_ai(row,overrides)) for row in merged.values()]
        selected=sorted((row for row,decision in decisions if decision is True),key=order)
        # Only ambiguous entries that could still reach the top ten are worth human review.
        cutoff=selected[9]['periodStars'] if len(selected)>=10 else None
        for row,decision in decisions:
            if decision is None and (cutoff is None or (row['periodStars'] or 0)>=cutoff):
                review('github-classification',row['repo'],'AI applicability uncertain',dict(description=row['description'],sourceUrl=row['url']))
        result[key]=dict(period=period,sourceUrl=url,fetchedAt=now,items=selected[:10])
    return result


def collect_aa(client,key):
    require(key,'AA key not configured')
    rows=[]; version=None; pages=None; seen=set(); deadline=time.monotonic()+120
    page=1
    while True:
        body=client.json('https://artificialanalysis.ai/api/v2/language/models/free?page='+str(page),{'x-api-key':key},deadline)
        current=body.get('intelligence_index_version')
        require(finite(current) or isinstance(current,str) and current.strip(),'AA index version missing')
        current=str(current)
        require(version is None or version==current,'AA index version changed during pagination')
        version=current
        p=body.get('pagination',{})
        require(type(p.get('page')) is int and p['page']==page,'AA missing/repeated page')
        require(type(p.get('total_pages')) is int and 1<=p['total_pages']<=100,'AA invalid page count')
        require(pages is None or pages==p['total_pages'],'AA page count changed')
        pages=p['total_pages']
        require(type(p.get('has_more')) is bool and p['has_more']==(page<pages),'AA incomplete pagination')
        require(type(p.get('page_size')) is int and p['page_size']>0,'AA page size missing')
        part=body.get('data'); require(isinstance(part,list) and part,'AA empty/missing page')
        require(len(part)<=p['page_size'] and (page==pages or len(part)==p['page_size']),'AA truncated page')
        for row in part:
            require(isinstance(row,dict) and isinstance(row.get('id'),str) and row['id'] not in seen,'AA duplicate/missing identity')
            seen.add(row['id'])
            require(isinstance(row.get('evaluations'),dict),'AA evaluations missing')
            text(row.get('name')); text(row.get('slug')); text(row.get('model_creator',{}).get('name'))
            if row.get('release_date') is not None:
                day(row['release_date'])
            for board in ('intelligence','coding'):
                field='artificial_analysis_'+board+'_index'
                require(field in row['evaluations'] and (row['evaluations'][field] is None or finite(row['evaluations'][field])),'AA missing/invalid index')
        rows.extend(part)
        if page==pages:
            return version,rows
        page+=1


INTERNAL_EVALUATIONS=('intelligence','coding')
INTELLIGENCE_INDEX='artificial_analysis_intelligence_index'
CODING_INDEX='artificial_analysis_coding_index'
REASONING_PARTS={'reasoning','non-reasoning','adaptive reasoning','reasoning effort',
                 'max effort','high effort','medium effort','low effort','xhigh effort',
                 'default fallback','high','medium','low','xhigh','max','minimal',
                 'thinking','non-thinking','none','default','off'}


def model_name(name):
    """Strip a trailing parenthetical only when every part is a reasoning/config marker.

    Version snapshots such as "(Dec '24)", "(32B)", "(0902)" or "(Preview)" are part
    of the model identity and must survive deduplication.
    """
    match=re.match(r'^(.*?)\s*\(([^()]*)\)\s*$',name)
    if not match:
        return name
    parts=[part.strip() for part in match.group(2).split(',')]
    def strippable(part):
        value=part.lower()
        return value in REASONING_PARTS or value.endswith('fallback') or value.startswith('based on ')
    return match.group(1) if parts and all(strippable(part) for part in parts) else name


def public_model_id(slug,aa_id):
    """Readable kebab-case ID derived from the AA slug; falls back to a hash when empty."""
    value=re.sub(r'[^a-z0-9]+','-',slug.lower()).strip('-')
    return value or 'aa-'+digest(aa_id)[:24]


def model_price(row):
    pricing=row.get('pricing') or {}
    costs=[]
    for key in ('price_1m_input_tokens','price_1m_output_tokens'):
        value=pricing.get(key)
        if value is None:
            costs.append(None)
        else:
            require(finite(value,0),'invalid AA price')
            costs.append(float(value))
    return costs


def model_data(version,rows,old,now,review):
    groups={}
    for row in rows:
        groups.setdefault(model_name(row['name']),[]).append(row)
    entries=[]; used=set()
    for name,items in sorted(groups.items()):
        scored=[r for r in items if r['evaluations'].get(INTELLIGENCE_INDEX) is not None]
        if not scored:
            scored=[r for r in items if r['evaluations'].get(CODING_INDEX) is not None]
        row=max(scored or items,key=lambda r:(r['evaluations'].get(INTELLIGENCE_INDEX) or -1,
                                               r['evaluations'].get(CODING_INDEX) or -1,r['slug']))
        identity=public_model_id(row['slug'],row['id'])
        if identity in used:
            identity=identity+'-'+digest(row['id'])[:6]
            review('models',row['id'],'model identifier collision',dict(slug=row['slug']))
        used.add(identity)
        input_cost,output_cost=model_price(row)
        priced=input_cost is not None or output_cost is not None
        model=dict(id=identity,name=name,vendor=row['model_creator']['name'],aaId=row['id'],
                   releasedAt=row['release_date'],inputCost=input_cost,outputCost=output_cost,
                   priceSource='artificial-analysis' if priced else None,
                   priceSourceUrl='https://artificialanalysis.ai/models/'+row['slug'] if priced else None,
                   priceUpdatedAt=now if priced else None)
        obj(model,MODEL)
        entries.append((model,row))
    rankings=dict(source='artificial-analysis',sourceUrl='https://artificialanalysis.ai/',indexVersion=version,updatedAt=now)
    for board,field in (('intelligence',INTELLIGENCE_INDEX),('coding',CODING_INDEX)):
        candidates=[dict(modelId=model['id'],score=row['evaluations'][field])
                    for model,row in entries if row['evaluations'].get(field) is not None]
        rankings[board]=[dict(v,rank=i) for i,v in enumerate(sorted(candidates,key=lambda v:(-v['score'],v['modelId']))[:30],1)]
    required={v['modelId'] for board in ('intelligence','coding') for v in rankings[board]}
    models=[model for model,_ in entries if model['id'] in required]
    return dict(dataUpdatedAt=now,rankings=rankings,models=sorted(models,key=lambda m:m['id']),plans=copy.deepcopy(old['plans']))


def parse_feed(raw,source,review):
    try:
        root=ET.fromstring(raw)
    except ET.ParseError as exc:
        raise DataError('RSS XML parse failed') from exc
    require(root.tag=='rss' and root.find('channel') is not None,'RSS structure changed')
    nodes=root.findall('./channel/item'); require(nodes,'RSS contains no items')
    result=[]
    for node in nodes:
        title=plain(node.findtext('title') or '')
        url=node.findtext('link') or ''
        try:
            safe_url(url)
            require(urlsplit(url).hostname in source['articleHosts'],'unexpected news host')
            require(title and re.search(r'[\u3400-\u9fff]',title) and '\ufffd' not in title,'invalid Chinese title')
            dt=parsedate_to_datetime(node.findtext('pubDate') or '')
            require(dt.tzinfo is not None,'RSS date timezone missing')
            published=dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
            result.append(dict(title=title,sourceUrl=url,publishedAt=published,source=source['name']))
        except (ValueError,TypeError,OverflowError) as exc:
            review('news-item',digest(url or title),'invalid RSS item: '+str(exc),dict(source=source['name']))
    require(result,'RSS has no valid dated Chinese articles')
    return result


NEWS_TOPICS = ('AI|模型|智能体|Agent|Claude|GPT|Gemini|DeepSeek|Copilot|Cursor|Qwen|GLM|人工智能|编程助手'
               '|Codex|Grok|Kimi|混元|通义|大语言模型|多模态|推理模型|开源模型|模型微调|模型评测|RAG'
               '|提示词|上下文工程|机器学习|深度学习|神经网络|算力|AI编程|代码生成|Vibe Coding|MCP'
               '|工具调用|工作流自动化|AI安全|AIGC|前端开发|数据可视化|低代码|自动化任务'
               '|Mistral|Ollama|ChatGPT|千问|智谱')


def topic_pattern(topics):
    """ASCII terms get ASCII-only boundaries so `AI` does not match OpenAI/AIGC but still matches AI编程."""
    parts=[]
    for term in topics.split('|'):
        if re.fullmatch(r'[A-Za-z0-9 ]+',term):
            parts.append(r'(?<![A-Za-z0-9])'+re.escape(term)+r'(?![A-Za-z0-9])')
        else:
            parts.append(re.escape(term))
    return '|'.join(parts)


TOPIC_RE=re.compile(topic_pattern(NEWS_TOPICS),re.I)
EXCLUDE_RE=re.compile(r'招聘|教程|培训|融资|专访|访谈|传闻|消息称|有望|或将|即将|将(?:开源|发布|推出|上线)|训练过程|技术细节'
                      r'|部分网友|网友.{0,4}称|据传|爆料|未官宣|疑似|内测中')


def news_event(title,official=False):
    """official sources are first-party announcements, so they skip the launch-verb requirement."""
    if EXCLUDE_RE.search(title):
        return None
    if not TOPIC_RE.search(title):
        return None
    if re.search(r'漏洞|停止服务|停服|安全更新|停止支持|泄露',title):
        return 'action-required'
    if re.search(r'降价|涨价|免费额度|免费层|免费开放|免费试用|限时免费|价格调整|订阅.*调价',title):
        return 'price-or-free'
    if re.search(r'评测|实测|测评|跑分|基准|榜单|登顶|SOTA|对比测试|更胜|超越',title,re.I):
        return 'model-review'
    if re.search(r'体验|上手|开箱|试用|深度使用|实测使用',title):
        return 'hands-on'
    launch = r'发布|推出|上线|开源|开放(?!权重)|升级|新增|更新|合并|释出|首发|登场'
    if official or re.search(launch,title):
        # Brand mentions alone do not establish a model release (e.g. Claude Office).
        product = r'功能|工具|浏览器|Firefox|Office|插件|客户端|应用|APP|API|工作台|保护模式|记忆|Copilot|Claude Code|Cursor|Ollama|ChatGPT|智能体|Agent'
        model = r'模型|GPT[- ]?\d|Gemini\s*\d|DeepSeek[- ]?V\d|Qwen[- ]?\d|GLM[- ]?\d|Claude\s*(?:Opus|Sonnet|Haiku|Fable)\s*\d'
        if re.search(product,title,re.I):
            return 'major-update'
        if re.search(model,title,re.I):
            return 'model-release'
        return 'major-update'
    if re.search(r'深度|解析|拆解|复盘|揭秘|梳理|观察|为何|背后|意味着|走向|格局|趋势|洞察|思考',title):
        return 'deep-analysis'
    return None


BEIJING=timezone(timedelta(hours=8))


def day_start_utc(year,month,day):
    """First-party pages give a Beijing date without a time; take that day's start (§4.5)."""
    return datetime(year,month,day,tzinfo=BEIJING).astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def parse_deepseek_news(html,source):
    tree=Tree(html).root
    result=[]; seen=set()
    for link in tree.find(lambda n:n.tag=='a' and re.fullmatch(r'/news/[\w.-]+/',n.attrs.get('href') or '')):
        href=link.attrs['href']
        if href in seen:
            continue
        seen.add(href)
        text=' '.join(link.text().split())
        date=re.search(r'(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日',text)
        if not date:
            continue
        heads=link.find(lambda n:n.tag in ('h2','h3'))
        if not heads:
            continue
        title=' '.join(heads[0].text().split())
        require(title,'DeepSeek news title empty')
        result.append(dict(title=title,sourceUrl=urljoin('https://www.deepseek.com',href),
                           publishedAt=day_start_utc(int(date.group(1)),int(date.group(2)),int(date.group(3))),
                           source=source['name']))
    require(result,'DeepSeek news list missing or restructured')
    return result


def verify_original(client,article,mapping,now,review):
    if not mapping:
        return None,None,None
    try:
        require(set(mapping)=={'url','publisher','articleEvidence','originalEvidence','eventSpecific'},'original mapping fields')
        safe_url(mapping['url']); require(mapping['publisher'] and mapping['articleEvidence'] and mapping['originalEvidence'],'original evidence empty')
        raw,final=client.get(article['sourceUrl'])
        require(normalize_url(final)==normalize_url(article['sourceUrl']),'article redirected')
        tree=Tree(decode(raw)).root
        linked=any(normalize_url(urljoin(final,n.attrs['href']))==normalize_url(mapping['url']) for n in tree.find(lambda n:n.tag=='a' and n.attrs.get('href','').startswith(('https://','http://','/'))))
        require(linked or normalize_url(final)==normalize_url(mapping['url']),'original URL not cited by article')
        require(mapping['articleEvidence'] in ' '.join(tree.text().split()),'article event evidence changed')
        original,final=client.get(mapping['url'])
        require(normalize_url(final)==normalize_url(mapping['url']),'original redirected')
        require(mapping['originalEvidence'] in plain(decode(original)),'official event evidence changed')
        return mapping['publisher'],mapping['url'],now
    except (ValueError,UnicodeError) as exc:
        review('news-original',digest(article['sourceUrl']),str(exc),dict(sourceUrl=article['sourceUrl']))
        return None,None,None


def aibase_article(raw,url,source):
    tree=Tree(decode(raw)).root
    headings=tree.find(lambda n:n.tag=='h1')
    require(len(headings)==1,'AIBase article heading changed')
    title=' '.join(headings[0].text().split())
    require(re.search(r'[\u3400-\u9fff]',title),'AIBase Chinese title missing')
    flight=''
    for script in tree.find(lambda n:n.tag=='script'):
        code=''.join(c for c in script.children if isinstance(c,str))
        match=re.fullmatch(r'self\.__next_f\.push\((.*)\)',code,re.S)
        if match:
            payload=json.loads(match[1])
            if isinstance(payload,list) and len(payload)>1 and payload[0]==1 and isinstance(payload[1],str):
                flight+=payload[1]
    matches=[]
    identity=urlsplit(url).path.rstrip('/').split('/')[-1]
    def visit(value):
        if isinstance(value,dict):
            if str(value.get('Id'))==identity and 'addtime' in value:
                matches.append(value)
            for child in value.values():
                visit(child)
        elif isinstance(value,list):
            for child in value:
                visit(child)
    decoder=json.JSONDecoder()
    # Flight text records are length-prefixed and may end without a newline.
    for boundary in re.finditer(r'(?<![\w])[0-9a-f]+:(?=[\[{])',flight):
        try:
            value,_=decoder.raw_decode(flight,boundary.end())
        except ValueError:
            continue  # Flight also contains non-JSON records; exact article is required below.
        visit(value)
    require(len(matches)==1 and matches[0].get('title')==title,'AIBase article identity/title mismatch')
    date_text=matches[0]['addtime']
    require(isinstance(date_text,str),'AIBase publication date missing')
    dt=datetime.fromisoformat(date_text)
    require(dt.tzinfo is not None,'AIBase publication timezone missing')
    return dict(title=title,sourceUrl=url,source=source['name'],publishedAt=dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))


def collect_aibase(client,raw,source):
    tree=Tree(decode(raw)).root
    urls=[]
    for node in tree.find(lambda n:n.tag=='a'):
        href=node.attrs.get('href','')
        match=re.fullmatch(r'/(?:zh/)?news/(\d+)',href)
        if match:
            url='https://www.aibase.com/zh/news/'+match[1]
            if url not in urls:
                urls.append(url)
    require(0<len(urls)<=60,'AIBase news list structure/size changed')
    rows=[]; deadline=time.monotonic()+120
    for url in urls:
        article,final=client.get(url,deadline=deadline)
        require(normalize_url(final)==url,'AIBase article redirected unexpectedly')
        rows.append(aibase_article(article,url,source))
    return rows


def collect_news(client,sources,originals,now,guard,review):
    candidates=[]; now_dt=datetime.fromisoformat(now)
    for source in sources:
        raw,final=client.get(source['url'])
        require(normalize_url(final)==normalize_url(source['url']),'RSS redirected unexpectedly')
        adapter=source.get('adapter','rss')
        require(adapter in ('rss','aibase','deepseek-news'),'unknown news adapter')
        if adapter=='aibase':
            rows=collect_aibase(client,raw,source)
        elif adapter=='deepseek-news':
            rows=parse_deepseek_news(decode(raw),source)
        else:
            rows=parse_feed(raw,source,review)
        guard(source['id'],len(rows))
        for row in rows:
            # Contract §4.5 URL normalization: keep article identity stable and strip tracking parameters.
            row=dict(row,sourceUrl=normalize_url(row['sourceUrl']))
            age=(now_dt-datetime.fromisoformat(row['publishedAt'])).total_seconds()
            if age < -300:
                review('news-future',digest(row['sourceUrl']),'publication is in the future',row)
                continue
            event=news_event(row['title'],official=adapter=='deepseek-news')
            if age>72*3600 or event is None:
                continue
            url=row['sourceUrl']; identity=digest(normalize_url(url))
            publisher,original,verified=verify_original(client,row,originals.get(identity),now,review)
            candidates.append(dict(row,id=identity,summary=None,lang='zh',originalSource=publisher,originalUrl=original,originalVerifiedAt=verified,
                                   url=original or url,category=CATEGORY_BY_EVENT[event],eventType=event))
    source_priority={s['name']:i for i,s in enumerate(sources)}
    dedup={}
    for item in sorted(candidates,key=lambda i:(i['sourceUrl']!=i['originalUrl'],source_priority[i['source']],i['publishedAt'],i['id'])):
        mapping=originals.get(item['id'],{})
        original=item['originalUrl']
        repo_root=original and urlsplit(original).hostname=='github.com' and len(urlsplit(original).path.strip('/').split('/'))==2
        event_key=normalize_url(original) if original and mapping.get('eventSpecific') is True and not repo_root else item['id']
        dedup.setdefault(event_key,item)
    result=[]; by_source={}; by_event={}
    for item in sorted(dedup.values(),key=news_order):
        # Contract §4.5: no single event type or source may take more than two slots.
        if by_source.get(item['source'],0)>=2 or by_event.get(item['eventType'],0)>=2:
            continue
        result.append(item)
        by_source[item['source']]=by_source.get(item['source'],0)+1
        by_event[item['eventType']]=by_event.get(item['eventType'],0)+1
        if len(result)==6:
            break
    return dict(dataUpdatedAt=now,items=result)


def select_scope(tree,scope):
    """Locate the evidence scope.

    Either an explicit tag/attrs selector, or content anchors (`contains`), which
    survive the build-hashed class names marketing pages regenerate on every deploy.
    """
    if 'contains' in scope:
        anchors=scope['contains']
        require(anchors and all(isinstance(a,str) and a for a in anchors),'invalid plan scope anchors')
        candidates=[]
        def walk(node):
            text=' '.join(node.text().split())
            if all(anchor in text for anchor in anchors):
                candidates.append((len(text),node))
            for child in node.children:
                if isinstance(child,Node):
                    walk(child)
        walk(tree)
        require(candidates,'plan scope anchors not found: '+','.join(anchors))
        return min(candidates,key=lambda item:item[0])[1]
    nodes=tree.find(lambda n:n.tag==scope['tag'] and all(n.attrs.get(k)==v for k,v in scope['attrs'].items()))
    require(len(nodes)==1,'official evidence scope changed')
    return nodes[0]


def collect_evidence_records(client,configs,old,now,review):
    """Verified page sections are pinned to evidence; changed facts require review.

    Adapters never treat a successful HTTP response as verification. Each record
    requires its own reviewed content scope and complete normalized fingerprint.
    """
    result={r['id']:copy.deepcopy(r) for r in old}
    succeeded=0
    day=(datetime.fromisoformat(now)+timedelta(hours=8)).date().isoformat()
    for config in configs:
        record=copy.deepcopy(config['record']); identity=record['id']
        try:
            obj(record,PLAN)
            require(config['approved'] is True,'initial product approval required')
            raw,final=client.get(record['sourceUrl'])
            require(normalize_url(final)==normalize_url(record['sourceUrl']),'official evidence redirected')
            tree=Tree(decode(raw)).root
            node=select_scope(tree,config['scope'])
            content=' '.join(node.text().split())
            adapter=config.get('adapter','verified-section')
            if adapter in ('copilot-plans','bigmodel-plans','pattern-plans'):
                record,fingerprint=parse_plan(node,record,adapter,config)
            else:
                require(adapter=='verified-section','unknown official adapter')
                fingerprint=content
            require(content and digest(fingerprint)==config['evidenceHash'],'official terms changed; retaining prior record')
            require(all(s in content for s in config['evidenceText']) and config['evidenceText'],'official fields not verified')
            record['updatedAt']=day
            record['checkMethod']='auto'
            result[identity]=record
            succeeded+=1
        except (ValueError,KeyError,TypeError) as exc:
            review('plans',identity,str(exc),dict(sourceUrl=record.get('sourceUrl')))
    require(not configs or succeeded>0,'all official plan sources failed verification')
    return list(result.values())


def table_rows(table):
    return [[' '.join(cell.text().split()) for cell in row.find(lambda n:n.tag in ('th','td'))]
            for row in table.find(lambda n:n.tag=='tr')]


def parse_plan(scope,record,adapter,config=None):
    """Extract numeric facts while pinning the surrounding semantics to review."""
    tables=scope.find(lambda n:n.tag=='table')
    fingerprint=' '.join(scope.text().split())
    if adapter=='pattern-plans':
        rules=config['tierRules']
        require(rules,'plan tier rules required')
        tiers=[]; masked=fingerprint
        for rule in rules:
            match=re.search(rule['price'],fingerprint)
            require(match and match.group(1),'plan tier pattern not found: '+rule['name'])
            amount=float(match.group(1).replace(',',''))
            require(finite(amount,0),'invalid plan price')
            tiers.append(dict(name=rule['name'],price=amount,currency=rule['currency'],period=rule['period'],
                              offerType=rule['offerType'],note=rule.get('note'),features=rule['features'],
                              conditions=rule['conditions']))
            masked=masked.replace(match.group(0),'# '+rule['name']+' #',1)
        unique(tiers,'name')
        record['tiers']=tiers
        return record,masked
    if adapter=='copilot-plans':
        matches=[(t,table_rows(t)) for t in tables if table_rows(t) and table_rows(t)[0]==['Plan','Price per month','Base credits','Flex allotment','Total monthly AI credits']]
        require(len(matches)==1,'Copilot individual billing table changed')
        table,rows=matches[0]
        require([r[0] for r in rows[1:]]==['Copilot Pro','Copilot Pro+','Copilot Max'],'Copilot tiers changed')
        tiers=[]
        for row in rows[1:]:
            require(len(row)==5 and re.fullmatch(r'\$\d+(?:\.\d+)? USD',row[1]),'Copilot currency/period changed')
            require(all(re.fullmatch(r'[\d,]+',v) for v in row[2:]),'Copilot credit units changed')
            require(int(row[2].replace(',',''))+int(row[3].replace(',',''))==int(row[4].replace(',','')),'Copilot credit totals changed')
            tiers.append(dict(name=row[0],price=float(row[1][1:-4]),currency='USD',period='month',offerType='standard',
                              note=None,features=['Base credits: '+row[2],'Flex allotment: '+row[3],'Total monthly AI credits: '+row[4]],
                              conditions='个人月付；不同档位的模型与 Agent 权益不同。地区、税费及支付条件以官方结算页为准；模型清单以官方页为准。'))
        record['tiers']=tiers
        # The overview repeats prices/credits; permit only numeric changes in the two billing tables.
        overview=[t for t in tables if table_rows(t) and table_rows(t)[0]==['Plan','Pricing','GitHub AI Credits','Agents','Models']]
        require(len(overview)==1,'Copilot overview table changed')
        for t in [table,overview[0]]:
            original=' '.join(t.text().split())
            fingerprint=fingerprint.replace(original,re.sub(r'\d[\d,.]*','#',original),1)
    elif adapter=='bigmodel-plans':
        matches=[(t,table_rows(t)) for t in tables if table_rows(t) and table_rows(t)[0]==['套餐类型','5 小时积分','每周积分']]
        require(len(matches)==1,'BigModel credit table changed')
        table,rows=matches[0]
        require([r[0] for r in rows[1:]]==['Lite 套餐','Pro 套餐','Max 套餐'],'BigModel tiers changed')
        tiers=[]
        for row in rows[1:]:
            require(len(row)==3 and all(re.fullmatch(r'[\d,]+',v) for v in row[1:]),'BigModel credit units changed')
            tiers.append(dict(name=row[0],price=None,currency='CNY',period='month',offerType='standard',
                              note=None,features=['5 小时积分：'+row[1],'每周积分：'+row[2]],
                              conditions='本页未提供当前月付价格，需前往官方订阅页确认。仅限指定工具；两种周期限额同时生效，非高峰抵扣规则见原文。地区、账号、支付及税费以官方为准；模型清单以官方页为准。'))
        record['tiers']=tiers
        original=' '.join(table.text().split())
        fingerprint=fingerprint.replace(original,re.sub(r'\d[\d,]*','#',original),1)
    else:
        raise DataError('unknown plan adapter')
    return record,fingerprint
