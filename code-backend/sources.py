"""Source adapters. Uncertain facts become review items, never guessed data."""
import copy
import json
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from urllib.parse import quote, urlencode, urljoin, urlsplit
from common import DataError, digest, finite, normalize_url, require, safe_url
from contract import CATEGORY_BY_EVENT, EVENTS, MODEL, PLAN, day, news_order, obj, text, unique


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


META_DESCRIPTION_RE=re.compile(
    r'<meta[^>]+(?:name|property)\s*=\s*["\'](?:description|og:description|twitter:description)["\'][^>]*>',re.I)
META_CONTENT_RE=re.compile(r'content\s*=\s*["\']([^"\']*)["\']',re.I)


def meta_description(raw):
    """Source-provided page description; `None` when the page carries none."""
    text=decode(raw) if isinstance(raw,(bytes,bytearray)) else raw
    for tag in META_DESCRIPTION_RE.findall(text):
        match=META_CONTENT_RE.search(tag)
        if match:
            value=plain(match.group(1))
            if value:
                return value
    return None


def article_excerpt(client,url,deadline):
    """Bounded source text for summary drafting; the body is never persisted.

    Prefers the page's own description, then a stripped snippet of the article text.
    Returns `None` when the page yields nothing usable.
    """
    raw,_=client.get(url,deadline=deadline)
    text=decode(raw)
    description=meta_description(text)
    if description:
        return description[:800]
    body=plain(re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>',' ',text))
    return body[:800] or None


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


DEEPSEEK_URL='https://api.deepseek.com/chat/completions'
# V4.1-Flash 的官方 API 模型 ID（deepseek-chat / deepseek-v4-flash 均已退役）。
DEEPSEEK_MODEL='deepseek-flash'
TRANSLATE_INSTRUCTIONS=('你是中文技术编辑。把给定 GitHub 仓库简介翻译成简体中文：保留产品名、模型名与专有名词原文，'
                        '不加评论与营销词，每条不超过 80 个汉字，单行纯文本。'
                        '只输出 JSON 对象，键为原样 repo，值为译文，不要输出其他内容。')
NEWS_TRANSLATE_INSTRUCTIONS=('你是中文科技编辑。把给定资讯条目的英文标题与简介翻译成简体中文：保留产品名、模型名、公司名与专有名词原文，'
                             '不加评论、不补充原文没有的信息；标题单行纯文本不超过 60 个汉字，简介单行纯文本不超过 80 个汉字；'
                             '没有简介的条目 summary 用空字符串。只输出 JSON 对象，键为原样 id，值为 {"title": "译文", "summary": "译文"}，不要输出其他内容。')


def translate_github(client, items, cached, key, now, review):
    """Machine-translate uncovered repo blurbs; cached maps repo -> dict(text,source,at).

    Manual blurbs win upstream; this only fills repos without one. The cache is
    pruned to repos seen this run and rewritten in place by the caller. Missing key
    or any failure keeps the English original and records at most one review item;
    translation never blocks publication.
    """
    seen={item['repo'] for item in items}
    for repo in list(cached):
        if repo not in seen:
            del cached[repo]
    result={repo:entry['text'] for repo,entry in cached.items()
            if isinstance(entry,dict) and isinstance(entry.get('text'),str) and entry['text'].strip()}
    pending={item['repo']:item['description'] for item in items
             if item['repo'] not in result and item['description']
             and not re.search(r'[\u3400-\u9fff]',item['description'])}
    if not pending or not key:
        return result
    try:
        body=dict(model=DEEPSEEK_MODEL,temperature=0,thinking=dict(type='disabled'),
                  response_format=dict(type='json_object'),max_tokens=4096,
                  messages=[dict(role='system',content=TRANSLATE_INSTRUCTIONS),
                            dict(role='user',content=json.dumps(pending,ensure_ascii=False))])
        payload=json.loads(client.post(DEEPSEEK_URL,body,{'Authorization':'Bearer '+key.strip()}))
        require(isinstance(payload,dict),'translation response malformed')
        choices=payload.get('choices')
        require(isinstance(choices,list) and choices and isinstance(choices[0],dict),'translation choices missing')
        message=choices[0].get('message')
        require(isinstance(message,dict) and isinstance(message.get('content'),str),'translation content missing')
        translated=json.loads(message['content'])
        require(isinstance(translated,dict),'translation payload malformed')
        # 只接受属于本轮待译集合、且确实含中文的单行译文；缺项留待下轮重试。
        accepted=0
        for repo,value in translated.items():
            if repo not in pending or not isinstance(value,str) or '\n' in value:
                continue
            if not value.strip() or not re.search(r'[\u3400-\u9fff]',value):
                continue
            cached[repo]=dict(text=value.strip(),source=DEEPSEEK_MODEL,at=now)
            result[repo]=value.strip()
            accepted+=1
        require(accepted,'translation produced no usable Chinese text')
    except (ValueError,KeyError,TypeError,UnicodeError) as exc:
        review('github-translate',digest('\n'.join(sorted(pending))),'translation failed: '+str(exc),
               dict(repos=sorted(pending)))
    return result


def translate_news(client,items,cached,key,now,review):
    """Machine-translate English news titles/summaries; cached maps item id -> dict(title,summary,source,at).

    Chinese items are never sent. Accepted translations require Chinese text, a single
    line and bounded length; missing/failed items are retried on a later run without
    blocking other candidates.
    """
    seen={item['id'] for item in items}
    for identity in list(cached):
        if identity not in seen:
            del cached[identity]
    result={identity:entry for identity,entry in cached.items()
            if isinstance(entry,dict) and isinstance(entry.get('title'),str) and entry['title'].strip()}
    pending={item['id']:dict(title=item['title'],summary=item.get('summary') or '')
             for item in items if item['id'] not in result}
    if not pending or not key:
        return result
    entries=list(pending.items())
    for start in range(0,len(entries),15):
        chunk=dict(entries[start:start+15])
        try:
            body=dict(model=DEEPSEEK_MODEL,temperature=0,thinking=dict(type='disabled'),
                      response_format=dict(type='json_object'),max_tokens=4096,
                      messages=[dict(role='system',content=NEWS_TRANSLATE_INSTRUCTIONS),
                                dict(role='user',content=json.dumps(chunk,ensure_ascii=False))])
            payload=json.loads(client.post(DEEPSEEK_URL,body,{'Authorization':'Bearer '+key.strip()}))
            require(isinstance(payload,dict),'translation response malformed')
            choices=payload.get('choices')
            require(isinstance(choices,list) and choices and isinstance(choices[0],dict),'translation choices missing')
            message=choices[0].get('message')
            require(isinstance(message,dict) and isinstance(message.get('content'),str),'translation content missing')
            translated=json.loads(message['content'])
            require(isinstance(translated,dict),'translation payload malformed')
            accepted=0
            for identity,value in translated.items():
                if identity not in chunk or not isinstance(value,dict):
                    continue
                title=value.get('title'); summary=value.get('summary')
                if not isinstance(title,str) or not re.search(r'[\u3400-\u9fff]',title) or '\n' in title or len(title.strip())>80:
                    continue
                title=title.strip()
                if isinstance(summary,str) and summary.strip() and '\n' not in summary and re.search(r'[\u3400-\u9fff]',summary) and len(summary.strip())<=80:
                    summary=summary.strip()
                else:
                    summary=None
                cached[identity]=dict(title=title,summary=summary,source=DEEPSEEK_MODEL,at=now)
                result[identity]=cached[identity]
                accepted+=1
            require(accepted,'translation produced no usable Chinese text')
        except (ValueError,KeyError,TypeError,UnicodeError) as exc:
            review('news-translate',digest('\n'.join(sorted(chunk))),'translation failed: '+str(exc),
                   dict(ids=sorted(chunk)))
    return result


NEWS_SUMMARY_INSTRUCTIONS=('你是中文科技资讯编辑。根据每条资讯的标题与来源片段，写一句简体中文简介：'
                           '不超过80个字符（含标点），单行纯文本；只使用标题与片段里出现的事实，'
                           '不添加、不推测、不评价、不照抄整句；不使用「本文」「据悉」「该文」等空话。'
                           '只输出 JSON 对象，键为原样 id，值为 {"summary": "简介"}，不要输出其他内容。')


def summarize_news(client,items,cached,key,now,review):
    """Model-drafted Chinese abstracts for items whose source provides no summary.

    `items` carry {id,title,text}; the article body is read for drafting only and never
    persisted. Accepted abstracts must be Chinese, single-line and within the contract
    bound; the cache keeps ids already drafted and failures are retried on a later run.
    """
    seen={item['id'] for item in items}
    for identity in list(cached):
        if identity not in seen:
            del cached[identity]
    result={identity:entry['summary'] for identity,entry in cached.items()
            if isinstance(entry,dict) and isinstance(entry.get('summary'),str) and entry['summary'].strip()}
    pending={item['id']:dict(title=item['title'],text=item['text'])
             for item in items if item['id'] not in result}
    if not pending or not key:
        return result
    entries=list(pending.items())
    for start in range(0,len(entries),10):
        chunk=dict(entries[start:start+10])
        try:
            body=dict(model=DEEPSEEK_MODEL,temperature=0,thinking=dict(type='disabled'),
                      response_format=dict(type='json_object'),max_tokens=4096,
                      messages=[dict(role='system',content=NEWS_SUMMARY_INSTRUCTIONS),
                                dict(role='user',content=json.dumps(chunk,ensure_ascii=False))])
            payload=json.loads(client.post(DEEPSEEK_URL,body,{'Authorization':'Bearer '+key.strip()}))
            require(isinstance(payload,dict),'summary response malformed')
            choices=payload.get('choices')
            require(isinstance(choices,list) and choices and isinstance(choices[0],dict),'summary choices missing')
            message=choices[0].get('message')
            require(isinstance(message,dict) and isinstance(message.get('content'),str),'summary content missing')
            drafted=json.loads(message['content'])
            require(isinstance(drafted,dict),'summary payload malformed')
            accepted=0
            for identity,value in drafted.items():
                if identity not in chunk or not isinstance(value,dict):
                    continue
                abstract=value.get('summary')
                if not isinstance(abstract,str) or '\n' in abstract or not re.search(r'[\u3400-\u9fff]',abstract):
                    continue
                abstract=abstract.strip()
                if not abstract or len(abstract)>80:
                    continue
                cached[identity]=dict(summary=abstract,source=DEEPSEEK_MODEL,at=now)
                result[identity]=abstract
                accepted+=1
            require(accepted,'summary produced no usable Chinese text')
        except (ValueError,KeyError,TypeError,UnicodeError) as exc:
            review('news-summary',digest('\n'.join(sorted(chunk))),'summary failed: '+str(exc),
                   dict(ids=sorted(chunk)))
    return result


GITHUB_LIMIT=30


def collect_github(client, now, languages, overrides, zh, guard, review, translate=None):
    """Global page plus admitted language pages; merged by repo, best page position wins.

    zh maps repo -> manually curated Chinese blurb; translate() returns machine
    drafts for repos it does not cover. Either source replaces the English
    description; uncovered repos keep the source text. Cached repos never call
    the API again, so repeated runs only translate newly admitted entries.
    """
    result=dict(source='github-trending',dataUpdatedAt=now); boards={}
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
        # Only ambiguous entries that could still reach the published board are worth human review.
        cutoff=selected[GITHUB_LIMIT-1]['periodStars'] if len(selected)>=GITHUB_LIMIT else None
        for row,decision in decisions:
            if decision is None and (cutoff is None or (row['periodStars'] or 0)>=cutoff):
                review('github-classification',row['repo'],'AI applicability uncertain',dict(description=row['description'],sourceUrl=row['url']))
        boards[key]=dict(period=period,sourceUrl=url,fetchedAt=now,items=selected[:GITHUB_LIMIT])
    # 人工简介优先；已缓存 repo 不再请求接口，因此重跑只会为新增条目调用翻译。
    machine=translate([item for board in boards.values() for item in board['items'] if item['repo'] not in zh]) if translate else {}
    for key,board in boards.items():
        result[key]=dict(board,items=[
            dict(item,description=zh.get(item['repo']) or machine.get(item['repo']) or item['description'])
            for item in board['items']
        ])
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


def first_child(node,name):
    for child in node:
        if child.tag.rsplit('}',1)[-1]==name:
            return child
    return None


def parse_feed(raw,source,review):
    try:
        root=ET.fromstring(raw)
    except ET.ParseError as exc:
        raise DataError('feed XML parse failed') from exc
    kind=root.tag.rsplit('}',1)[-1]
    require(kind in ('rss','feed'),'feed structure changed')
    if kind=='rss':
        channels=[node for node in root if node.tag=='channel']
        require(len(channels)==1,'RSS channel changed')
        nodes=channels[0].findall('item')
    else:
        nodes=[node for node in root if node.tag.rsplit('}',1)[-1]=='entry']
    require(nodes,'feed contains no items')
    result=[]
    for node in nodes:
        title=' '.join(((first_child(node,'title').text if first_child(node,'title') is not None else '') or '').split())
        url=''; date_text=''; summary=''
        if kind=='rss':
            link=first_child(node,'link')
            url=' '.join(((link.text if link is not None else '') or '').split())
            date_text=(first_child(node,'pubDate').text if first_child(node,'pubDate') is not None else '') or ''
            description=first_child(node,'description')
            summary=' '.join(((description.text if description is not None else '') or '').split())
        else:
            for child in node:
                name=child.tag.rsplit('}',1)[-1]
                if name=='link' and not url and child.attrib.get('rel') in (None,'alternate'):
                    url=(child.attrib.get('href') or '').strip()
                elif name=='summary' and not summary:
                    summary=' '.join((child.text or '').split())
            for name in ('published','updated'):
                found=first_child(node,name)
                if found is not None and (found.text or '').strip():
                    date_text=found.text; break
        try:
            url=urljoin(source['url'],url)
            safe_url(url)
            require(urlsplit(url).hostname in source['articleHosts'],'unexpected news host')
            require(title and '\ufffd' not in title,'invalid news title')
            if source.get('lang','zh')=='zh':
                require(re.search(r'[\u3400-\u9fff]',title),'invalid Chinese title')
            dt=parsedate_to_datetime(date_text) if kind=='rss' else datetime.fromisoformat(date_text.replace('Z','+00:00'))
            require(dt.tzinfo is not None,'feed date timezone missing')
            published=dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
            result.append(dict(title=title,sourceUrl=url,publishedAt=published,source=source['name'],
                               summary=plain(summary)[:800] or None))
        except (ValueError,TypeError,OverflowError) as exc:
            review('news-item',digest(url or title),'invalid feed item: '+str(exc),dict(source=source['name']))
    require(result,'feed has no valid dated articles')
    return result


NEWS_TOPICS = ('AI|模型|智能体|Agent|Claude|GPT|Gemini|DeepSeek|Copilot|Cursor|Qwen|GLM|人工智能|编程助手'
                '|Codex|Grok|Kimi|混元|通义|大语言模型|多模态|推理模型|开源模型|模型微调|模型评测|RAG'
                '|提示词|上下文工程|机器学习|深度学习|神经网络|算力|AI编程|代码生成|Vibe Coding|MCP'
                '|工具调用|工作流自动化|AI安全|AIGC|Seedream|Seedance|Seed3D|豆包'
                '|Mistral|Ollama|ChatGPT|千问|智谱|文心|ERNIE|星火')


def topic_pattern(topics):
    """ASCII terms get ASCII-only boundaries so `AI` does not match OpenAI/AIGC but still matches AI编程.

    The trailing guard blocks letters only, so brand+digit model names like `Qwen3.8`
    or `GPT5` still match while `AIGC`/`OpenAI` do not become `AI` hits.
    """
    parts=[]
    for term in topics.split('|'):
        if re.fullmatch(r'[A-Za-z0-9 ]+',term):
            parts.append(r'(?<![A-Za-z0-9])'+re.escape(term)+r'(?![A-Za-z])')
        else:
            parts.append(re.escape(term))
    return '|'.join(parts)


TOPIC_RE=re.compile(topic_pattern(NEWS_TOPICS),re.I)
MEDIA_EXCLUDE_RE=re.compile(r'招聘|教程|培训|融资|专访|访谈|传闻|消息称|有望|或将|即将'
                            r'|将(?:于|在)?[^，。；]{0,20}(?:发布|推出|上线|开源)|训练过程|技术细节'
                            r'|部分网友|网友.{0,4}称|据传|爆料|未官宣|疑似|内测中')
OFFICIAL_EXCLUDE_RE=re.compile(r'招聘|教程|培训|融资|营销|赞助|广告|专访|访谈|业绩|财报|年报'
                                r'|客户案例|案例研究|客户故事|成功故事|白皮书|借助|如何用|如何使用')
UPCOMING_RE=re.compile(r'将(?:于|在)?[^，。；]{0,20}(?:发布|推出|上线|开源|开放|升级|登场|释出)'
                       r'|即将|预告|预览|抢先看|coming soon|waitlist',re.I)
RELEASED_RE=re.compile(r'已(?:经)?|正式|现已')
LAUNCH_RE=re.compile(r'发布|推出|上线|开源|开放(?!权重)|升级|新增|更新|合并|释出|首发|登场')
PRODUCT_RE=re.compile(r'功能|工具|浏览器|Firefox|Office|插件|客户端|应用|APP|API|工作台|保护模式|记忆'
                      r'|Copilot|Claude Code|Cursor|Ollama|ChatGPT|智能体|Agent',re.I)
MODEL_SIGNAL_RE=re.compile(r'模型|GPT[- ]?\d|Gemini\s*\d|DeepSeek[- ]?V\d|Qwen[- ]?\d|GLM[- ]?\d'
                           r'|Claude\s*(?:Opus|Sonnet|Haiku|Fable)\s*\d')
OFFICIAL_MODEL_RE=re.compile(r'GPT[- ]?\d|Gemini\s*\d|DeepSeek[- ]?V\d|Qwen[- ]?\d|GLM[- ]?\d'
                             r'|Claude\s*(?:Opus|Sonnet|Haiku|Fable)\s*\d'
                              r'|Kimi[- ]?K\d|MiniMax[- ]?M\d|Step[- ]?\d|ERNIE[- ]?\d|Hunyuan|文心[- ]?\d|Seed(?:ream|ance|3D|-OSS)'
                             r'|(?:发布|推出|上线|开源|升级|更新)[^，。；]{0,10}(?:模型|大模型)'
                             r'|(?:模型|大模型)[^，。；]{0,10}(?:发布|推出|上线|开源)')


def news_event(title,official=False):
    """Official sources are first-party: previews become `upcoming`; media keep the strict verb rules."""
    exclude=OFFICIAL_EXCLUDE_RE if official else MEDIA_EXCLUDE_RE
    if exclude.search(title):
        return None
    if not TOPIC_RE.search(title):
        return None
    if re.search(r'漏洞|停止服务|停服|安全更新|停止支持|泄露|弃用|废弃|下线|停用|迁移',title):
        return 'action-required'
    if re.search(r'降价|涨价|免费额度|免费层|免费开放|免费试用|限时免费|价格调整|订阅.*调价',title):
        return 'price-or-free'
    if official:
        # 预告优先于发布类；「已/正式/现已」加发布动词视为已发布。仅主题命中不发布。
        if UPCOMING_RE.search(title) and not (RELEASED_RE.search(title) and LAUNCH_RE.search(title)):
            return 'upcoming'
        if OFFICIAL_MODEL_RE.search(title):
            return 'model-release'
        if PRODUCT_RE.search(title) or LAUNCH_RE.search(title):
            return 'major-update'
        return None
    if re.search(r'评测|实测|测评|跑分|基准|榜单|登顶|SOTA|对比测试|更胜|超越',title,re.I):
        return 'model-review'
    if re.search(r'体验|上手|开箱|试用|深度使用|实测使用',title):
        return 'hands-on'
    if LAUNCH_RE.search(title):
        # Brand mentions alone do not establish a model release (e.g. Claude Office).
        if PRODUCT_RE.search(title):
            return 'major-update'
        if MODEL_SIGNAL_RE.search(title):
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
    flight=flight_payloads(raw)
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
    return dict(title=title,sourceUrl=url,source=source['name'],summary=meta_description(raw),
                publishedAt=dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))


def collect_aibase(client,raw,source,review):
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
        try:
            rows.append(aibase_article(article,url,source))
        except ValueError as exc:
            # 个别文章页缺少内嵌数据（如专题页）；隔离该条，骤降保护兜底整体回归。
            review('news-item',digest(url),'invalid AIBase article: '+str(exc),dict(source=source['name']))
    require(rows,'AIBase produced no valid articles')
    return rows


def collect_aibase_backfill(client,rows,source,now_dt,window_seconds):
    """One-off backfill: walk article ids downwards until the window is covered.

    The list page only carries the latest articles, so older ids are probed directly.
    Ids run roughly chronologically; the walk stops after a run of out-of-window
    articles or a hard cap, so a restructured site cannot become an endless crawl.
    """
    ids=[]
    for row in rows:
        match=re.search(r'/news/(\d+)$',row['sourceUrl'])
        if match:
            ids.append(int(match.group(1)))
    require(ids,'AIBase list produced no article ids')
    floor=min(ids)
    cutoff=now_dt-timedelta(seconds=window_seconds)
    result=[]; deadline=time.monotonic()+900; stale=0
    for identity in range(floor-1,max(floor-320,0),-1):
        if stale>=12 or time.monotonic()>deadline:
            break
        url='https://www.aibase.com/zh/news/%d'%identity
        try:
            article,_=client.get(url,deadline=deadline)
            row=aibase_article(article,url,source)
        except (ValueError,KeyError,TypeError,UnicodeError):
            continue
        if datetime.fromisoformat(row['publishedAt'])<cutoff:
            stale+=1
            continue
        stale=0
        result.append(row)
    return result


def parse_anthropic_news(raw,source):
    """Anthropic /news: server-rendered list, one <time> + title node per card."""
    tree=Tree(decode(raw)).root
    rows=[]; seen=set()
    for link in tree.find(lambda n:n.tag=='a' and (n.attrs.get('href') or '').startswith('/news/')):
        href=link.attrs['href']
        if href in seen:
            continue
        times=link.find(lambda n:n.tag=='time')
        heads=link.find(lambda n:'title' in (n.attrs.get('class') or '') or n.tag in ('h2','h3','h4'))
        if not times or not heads:
            continue
        title=' '.join(heads[0].text().split())
        date=' '.join(times[0].text().split())
        require(title,'Anthropic news title empty')
        try:
            dt=datetime.strptime(date,'%b %d, %Y')
        except ValueError as exc:
            raise DataError('Anthropic news date format changed') from exc
        seen.add(href)
        rows.append(dict(title=title,sourceUrl=urljoin('https://www.anthropic.com',href),
                         publishedAt=day_start_utc(dt.year,dt.month,dt.day),source=source['name'],summary=None))
    require(rows,'Anthropic news list missing or restructured')
    return rows


def flight_payloads(raw):
    """Concatenated Next.js RSC payload strings, shared by flight-based adapters."""
    flight=''
    for script in Tree(decode(raw)).root.find(lambda n:n.tag=='script'):
        code=''.join(c for c in script.children if isinstance(c,str))
        match=re.fullmatch(r'self\.__next_f\.push\((.*)\)',code,re.S)
        if match:
            payload=json.loads(match[1])
            if isinstance(payload,list) and len(payload)>1 and payload[0]==1 and isinstance(payload[1],str):
                flight+=payload[1]
    return flight


def parse_zhipu_news(raw,source):
    """Zhipu /zh/news: the RSC payload embeds newsItems with id/title_zh/createAt (UTC)."""
    flight=flight_payloads(raw)
    marker=flight.find('"newsItems":')
    require(marker>=0,'Zhipu news payload missing')
    items,_=json.JSONDecoder().raw_decode(flight,flight.find('[',marker))
    require(isinstance(items,list) and items,'Zhipu news list missing or restructured')
    result=[]; seen=set()
    for item in items:
        require(isinstance(item,dict) and isinstance(item.get('id'),int),'Zhipu news item identity changed')
        title=item.get('title_zh'); created=item.get('createAt')
        require(isinstance(title,str) and isinstance(created,str),'Zhipu news item fields changed')
        url='https://www.zhipuai.cn/zh/news/%d'%item['id']
        if url in seen:
            continue
        title=' '.join(title.replace('\ufeff',' ').split())
        require(title,'Zhipu news title empty')
        dt=datetime.fromisoformat(created.replace('Z','+00:00'))
        require(dt.tzinfo is not None,'Zhipu news date timezone missing')
        seen.add(url)
        result.append(dict(title=title,sourceUrl=url,
                           publishedAt=dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                           source=source['name'],summary=None))
    require(result,'Zhipu news produced no rows')
    return result


TENCENT_THIRD_PARTY_RE=re.compile(r'DeepSeek|GLM|Kimi|MiniMax|Qwen|千问|MiMo|智谱|阶跃')


def parse_tencent_announcements(raw,source):
    """TokenHub 产品公告: rows link to dated /announce/{id} detail pages.

    The board also carries hosting notices for third-party vendors; those are
    their vendors' own news, so only Tencent-first-party rows are returned.
    """
    tree=Tree(decode(raw)).root
    result=[]; seen=set()
    for row in tree.find(lambda n:n.tag=='tr'):
        links=row.find(lambda n:n.tag=='a' and re.fullmatch(r'https://cloud\.tencent\.com/announce/detail/\d+',n.attrs.get('href') or ''))
        cells=row.find(lambda n:n.tag=='td')
        if not links or len(cells)<2:
            continue
        title=' '.join(links[0].text().replace('\ufeff',' ').split())
        date=' '.join(cells[-1].text().replace('\ufeff',' ').split())
        if not title or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',date):
            continue
        url=links[0].attrs['href']
        if url in seen:
            continue
        seen.add(url)
        if TENCENT_THIRD_PARTY_RE.search(title):
            continue
        year,month,day=(int(part) for part in date.split('-'))
        result.append(dict(title=title,sourceUrl=url,
                           publishedAt=day_start_utc(year,month,day),source=source['name'],summary=None))
    require(result,'Tencent announcement table missing or restructured')
    return result


def clip(value,limit):
    """Fit source text into the contract summary bound, preferring a sentence/clause end."""
    text=' '.join(value.split())
    if len(text)<=limit:
        return text
    head=text[:limit]
    for mark in ('。','；','！','？','，','、'):
        at=head.rfind(mark)
        if at>=limit//2:
            return head[:at+1]
    return head


def abstract(value,limit=80):
    """News summary from source text: clipped, never ending on a bare separator."""
    text=clip(value,limit)
    while text and text[-1] in '，、；':
        text=text[:-1]
    return text


def row_url(page,**fields):
    """Stable synthetic identity for catalog rows that carry no per-row URL.

    normalize_url keeps non-tracking query parameters, so the normalized URL is
    deterministic and unique per (page, row) without changing field semantics.
    """
    return page+'?'+urlencode(sorted(fields.items()))


BAILIAN_MODEL_RE=re.compile(r'qwen|qwq|qvq',re.I)


def parse_bailian(raw,source):
    """Alibaba Model Studio catalog: Qwen-family additions only; no per-row URLs.

    The model cell may list an alias plus its dated snapshot; the first token is
    the stable identity, and every token must look like a model ID.
    """
    tree=Tree(decode(raw)).root
    result=[]; seen=set()
    for row in tree.find(lambda n:n.tag=='tr'):
        cells=row.find(lambda n:n.tag in ('td','th'))
        if len(cells)!=4:
            continue
        _,date,models,description=[' '.join(c.text().replace('\ufeff',' ').split()) for c in cells]
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',date):
            continue
        tokens=models.split()
        if not tokens or not all(re.fullmatch(r'[A-Za-z0-9][\w./-]*',token) for token in tokens):
            continue
        model=tokens[0]
        if not BAILIAN_MODEL_RE.match(model):
            continue
        url=row_url(source['url'],date=date,model=model)
        if url in seen:
            continue
        seen.add(url)
        year,month,day=(int(part) for part in date.split('-'))
        result.append(dict(title='阿里发布 '+model,sourceUrl=url,publishedAt=day_start_utc(year,month,day),
                           source=source['name'],summary=clip(description,80) or None))
    require(result,'Alibaba catalog table missing or restructured')
    return result


TENCENT_MODEL_RE=re.compile(r'(?i)^(hy|yt|hunyuan|混元)')


def parse_tokenhub_dynamics(raw,source):
    """TokenHub 产品动态: Tencent-family model additions; rows carry no per-row URL."""
    tree=Tree(decode(raw)).root
    result=[]; seen=set()
    for row in tree.find(lambda n:n.tag=='tr'):
        cells=row.find(lambda n:n.tag in ('td','th'))
        if len(cells)<4:
            continue
        description=' '.join(cells[1].text().replace('\ufeff',' ').split())
        date=' '.join(cells[2].text().replace('\ufeff',' ').split())
        match=re.search(r'新增支持 (.+?) 模型',description)
        if not match or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',date):
            continue
        names=[name.strip() for name in re.split(r'[、,，/]',match.group(1))
               if name.strip() and TENCENT_MODEL_RE.match(name)]
        if not names:
            continue
        slug=re.sub(r'[^a-z0-9]+','-',' '.join(names).lower()).strip('-')
        url=row_url(source['url'],date=date,model=slug)
        if url in seen:
            continue
        seen.add(url)
        year,month,day=(int(part) for part in date.split('-'))
        result.append(dict(title='腾讯云 TokenHub 上线 '+'、'.join(names)+' 模型',sourceUrl=url,
                           publishedAt=day_start_utc(year,month,day),source=source['name'],
                           summary=clip(description,80) or None))
    require(result,'Tencent TokenHub dynamics missing or restructured')
    return result


QIANFAN_ACTION={'上新':'上线','升级':'升级','退役':'下线'}


def parse_qianfan(raw,source):
    """Baidu Qianfan model log: Baidu-first-party rows; the year comes from month sections."""
    tree=Tree(decode(raw)).root
    result=[]; seen=set(); year=None
    for node in tree.find(lambda n:n.tag in ('h2','h3','table')):
        if node.tag in ('h2','h3'):
            match=re.fullmatch(r'(20\d{2})年(\d{1,2})月',node.text().strip())
            if match:
                year=int(match.group(1))
            continue
        if year is None:
            continue
        for row in node.find(lambda n:n.tag=='tr'):
            cells=row.find(lambda n:n.tag in ('td','th'))
            values=[' '.join(c.text().replace('\ufeff',' ').split()) for c in cells]
            if len(values)<7 or '百度' not in values[1]:
                continue
            date=re.fullmatch(r'(\d{1,2})月(\d{1,2})日',values[0])
            version=values[3] or values[2]
            if not date or not version or not values[5]:
                continue
            month,day=int(date.group(1)),int(date.group(2))
            try:
                stamp=day_start_utc(year,month,day)
            except ValueError:
                continue
            url=row_url(source['url'],date='%04d-%02d-%02d'%(year,month,day),
                        model=re.sub(r'[^a-z0-9]+','-',version.lower()).strip('-'))
            if url in seen:
                continue
            seen.add(url)
            result.append(dict(title='百度千帆'+QIANFAN_ACTION.get(values[5],values[5])+' '+version,sourceUrl=url,
                               publishedAt=stamp,source=source['name'],summary=clip(values[6],80) or None))
    require(result,'Qianfan model log missing or restructured')
    return result


def parse_kimi_blog(raw,source):
    """Kimi research blog: card names are bare proper nouns, so the vendor template is used."""
    tree=Tree(decode(raw)).root
    result=[]; seen=set()
    for card in tree.find(lambda n:n.tag=='div' and 'menu-card' in (n.attrs.get('class') or '')):
        links=card.find(lambda n:n.tag=='a' and re.fullmatch(r'/en/blog/[\w.-]+',n.attrs.get('href') or ''))
        titles=card.find(lambda n:n.tag in ('h2','h3','h4') and 'card-title' in (n.attrs.get('class') or ''))
        dates=card.find(lambda n:n.tag=='p' and 'card-date' in (n.attrs.get('class') or ''))
        if not links or not titles or not dates:
            continue
        url=urljoin('https://www.kimi.com',links[0].attrs['href'])
        if url in seen:
            continue
        title=' '.join(titles[0].text().split())
        date=' '.join(dates[0].text().split())
        if not title or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',date):
            continue
        seen.add(url)
        year,month,day=(int(part) for part in date.split('-'))
        result.append(dict(title='月之暗面发布 '+title,sourceUrl=url,publishedAt=day_start_utc(year,month,day),
                           source=source['name'],summary=None))
    require(result,'Kimi research blog missing or restructured')
    return result


def sitemap_entries(raw,prefix):
    """Shared sitemap <loc>/<lastmod> reader for official news sitemaps."""
    root=ET.fromstring(raw)
    require(root.tag.rsplit('}',1)[-1]=='urlset','sitemap structure changed')
    result=[]
    for node in root:
        loc=last=None
        for child in node:
            name=child.tag.rsplit('}',1)[-1]
            if name=='loc':
                loc=(child.text or '').strip()
            elif name=='lastmod':
                last=(child.text or '').strip()
        if loc and last and loc.startswith(prefix):
            result.append((loc,last))
    require(result,'sitemap contains no matching entries')
    return result


def recent_entry(last,now_dt,seconds=72*3600):
    """Sitemap lastmod gate: tolerates malformed entries instead of failing the source."""
    try:
        stamp=datetime.fromisoformat(last.replace('Z','+00:00'))
    except ValueError:
        return False
    if stamp.tzinfo is None:
        return False
    age=(now_dt-stamp).total_seconds()
    return -300<=age<=seconds


def collect_xai(client,raw,source,now,window_seconds=72*3600):
    """x.ai sitemap for discovery; article page supplies h1 title and datePublished."""
    now_dt=datetime.fromisoformat(now)
    rows=[]; deadline=time.monotonic()+120
    for loc,last in sitemap_entries(raw,'https://x.ai/news/'):
        if not re.fullmatch(r'https://x\.ai/news/[\w.-]+',loc) or not recent_entry(last,now_dt,window_seconds):
            continue
        page,final=client.get(loc,deadline=deadline)
        require(normalize_url(final)==loc,'xAI article redirected unexpectedly')
        text=decode(page)
        heads=Tree(text).root.find(lambda n:n.tag=='h1')
        match=re.search(r'"datePublished"\s*:\s*"([^"]+)"',text)
        require(heads and match,'xAI article structure changed')
        title=' '.join(heads[0].text().split())
        require(title,'xAI article title empty')
        dt=datetime.fromisoformat(match.group(1).replace('Z','+00:00'))
        require(dt.tzinfo is not None,'xAI article date timezone missing')
        rows.append(dict(title=title,sourceUrl=loc,source=source['name'],summary=meta_description(text),
                         publishedAt=dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')))
    return rows


def collect_seed(client,raw,source,now,window_seconds=72*3600):
    """ByteDance Seed sitemap for discovery; article page supplies h1 title and 发布日期."""
    now_dt=datetime.fromisoformat(now)
    rows=[]; deadline=time.monotonic()+120
    for loc,last in sitemap_entries(raw,'https://seed.bytedance.com/blog/'):
        if not recent_entry(last,now_dt,window_seconds):
            continue
        page,final=client.get(loc,deadline=deadline)
        zh=loc.replace('/blog/','/zh/blog/',1)
        require(normalize_url(final) in (normalize_url(loc),normalize_url(zh)),'Seed article redirected unexpectedly')
        url=normalize_url(final)
        text=decode(page)
        heads=Tree(text).root.find(lambda n:n.tag=='h1')
        match=re.search(r'font-normal">(\d{4}-\d{2}-\d{2})<',text)
        if not heads or not match:
            review('news-item',digest(url),'Seed article structure changed',dict(source=source['name']))
            continue
        title=' '.join(heads[0].text().split())
        require(title,'Seed article title empty')
        year,month,day=(int(part) for part in match.group(1).split('-'))
        rows.append(dict(title=title,sourceUrl=url,source=source['name'],summary=meta_description(text),
                         publishedAt=day_start_utc(year,month,day)))
    return rows


def parse_minimax_blog(raw,source):
    """MiniMax /blog: server list page links; titles/dates come from each article page."""
    tree=Tree(decode(raw)).root
    urls=[]
    for node in tree.find(lambda n:n.tag=='a'):
        href=node.attrs.get('href','')
        if re.fullmatch(r'/blog/[\w%.-]+',href):
            url=urljoin(source['url'],href)
            if url not in urls:
                urls.append(url)
    require(0<len(urls)<=60,'MiniMax blog list structure/size changed')
    return urls


def collect_minimax(client,raw,source):
    rows=[]; deadline=time.monotonic()+180
    for url in parse_minimax_blog(raw,source):
        page,final=client.get(url,deadline=deadline)
        require(normalize_url(final)==url,'MiniMax article redirected unexpectedly')
        text=decode(page)
        heads=Tree(text).root.find(lambda n:n.tag=='h1')
        match=re.search(r'"datePublished"\s*:\s*"([^"]+)"',text)
        if not heads or not match:
            review('news-item',digest(url),'MiniMax article structure changed',dict(source=source['name']))
            continue
        title=' '.join(heads[0].text().split())
        require(title,'MiniMax article title empty')
        dt=datetime.fromisoformat(match.group(1).replace('Z','+00:00'))
        require(dt.tzinfo is not None,'MiniMax article date timezone missing')
        rows.append(dict(title=title,sourceUrl=url,source=source['name'],summary=meta_description(text),
                         publishedAt=dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')))
    require(rows,'MiniMax blog parsing produced no articles')
    return rows


BRAND_TOKEN_RE=re.compile(r'[A-Za-z][A-Za-z0-9._-]*\d[A-Za-z0-9._-]*')


def normalized_title(title):
    return re.sub(r'[^0-9a-z\u4e00-\u9fff]','',title.lower())


def brand_tokens(title):
    tokens=set()
    for raw in BRAND_TOKEN_RE.findall(title):
        token=re.sub(r'[^a-z0-9]','',raw.lower())
        if len(token)>=4:
            tokens.add(token)
    return tokens


def title_bigrams(text):
    if len(text)<8:
        return set()
    return {text[i:i+2] for i in range(len(text)-1)}


def similar_event(a,b):
    """Same-type titles describing one event are duplicates; different event types coexist."""
    if a['eventType']!=b['eventType']:
        return False
    if brand_tokens(a['title']) & brand_tokens(b['title']):
        return True
    na,nb=normalized_title(a['title']),normalized_title(b['title'])
    if len(min(na,nb))>=10 and (na in nb or nb in na):
        return True
    ba,bb=title_bigrams(na),title_bigrams(nb)
    if not ba or not bb:
        return False
    return 2*len(ba&bb)/(len(ba)+len(bb))>=0.9


def parse_huggingface_models(raw,source):
    """Official vendor orgs on Hugging Face: a new model repo counts as a model release.

    The hub API provides no article title, so the Chinese title is the fixed template
    「{厂商}发布 {模型名}」; no other wording may be added.
    """
    rows=json.loads(decode(raw))
    require(isinstance(rows,list) and rows,'Hugging Face model list changed')
    result=[]
    for row in rows:
        if not isinstance(row,dict) or not isinstance(row.get('modelId'),str) or not isinstance(row.get('createdAt'),str):
            continue
        require(row['modelId'].startswith(source['author']+'/'),'Hugging Face model identity changed')
        dt=datetime.fromisoformat(row['createdAt'].replace('Z','+00:00'))
        require(dt.tzinfo is not None,'Hugging Face createdAt timezone missing')
        name=row['modelId'].split('/',1)[1]
        result.append(dict(title=source['titleVendor']+'发布 '+name,
                           sourceUrl='https://huggingface.co/'+row['modelId'],
                           publishedAt=dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                           source=source['name'],summary=None))
    require(result,'Hugging Face model list produced no rows')
    return result


def fill_news_summaries(client,items,summarize,limit=40):
    """Draft Chinese abstracts for items whose source provides none.

    Article text is read in memory for drafting only and never persisted; failures stay
    empty and are retried on a later run. Only a bounded number of articles is read per
    run, so a large archive cannot turn one collection into a crawl.
    """
    pending=[]; deadline=time.monotonic()+240
    for item in items:
        if item.get('summary'):
            continue
        # 目录型条目的 URL 是合成身份（目录页 + 行参数），不是可读的文章页。
        if '?' in item['url']:
            continue
        if len(pending)>=limit or time.monotonic()>deadline:
            break
        try:
            excerpt=article_excerpt(client,item['url'],deadline)
        except (ValueError,KeyError,TypeError,UnicodeError):
            excerpt=None
        if not excerpt:
            continue
        pending.append(dict(id=item['id'],title=item['title'],text=excerpt))
    if not pending:
        return 0
    drafted=summarize(pending)
    filled=0
    for item in items:
        value=drafted.get(item['id'])
        if value:
            item['summary']=value; filled+=1
    return filled


def collect_news(client,sources,originals,old,now,guard,review,translate=None,summarize=None,
                 window_seconds=72*3600,backfill=False):
    """Official-first news collection.

    Items accumulate forever in the published file: `addedAt` marks admission and the
    daily quota (Beijing day) caps new items per day, source and event type. English
    titles and summaries pass through `translate` before classification; a failed
    translation only skips that candidate for this run.

    `window_seconds` bounds admission age (72h in normal runs). `backfill` is the
    documented one-off mode: the window widens to the requested span and `addedAt` takes
    the publication time, so historical days stay on their own daily budgets. Items whose
    source carries no summary get a model-drafted one through `summarize`.
    """
    candidates=[]; now_dt=datetime.fromisoformat(now)
    known={item['id'] for item in old.get('items',[])}
    seen=set()
    for source in sources:
        raw,final=client.get(source['url'])
        require(normalize_url(final)==normalize_url(source['url']),'news source redirected unexpectedly')
        adapter=source.get('adapter','rss')
        require(adapter in ('rss','aibase','deepseek-news','anthropic-news','xai-sitemap','seed-blog','minimax-blog','huggingface-models','zhipu-news','tencent-announce','alibaba-bailian','tencent-tokenhub','baidu-qianfan','kimi-blog'),'unknown news adapter')
        official=source.get('official') is True
        if adapter=='aibase':
            rows=collect_aibase(client,raw,source,review)
            if backfill:
                # 列表页只带最新文章，回补时按 id 下探到更早的页面（一次性路径）。
                rows=rows+collect_aibase_backfill(client,rows,source,now_dt,window_seconds)
        elif adapter=='deepseek-news':
            rows=parse_deepseek_news(decode(raw),source)
        elif adapter=='anthropic-news':
            rows=parse_anthropic_news(raw,source)
        elif adapter=='zhipu-news':
            rows=parse_zhipu_news(raw,source)
        elif adapter=='tencent-announce':
            rows=parse_tencent_announcements(raw,source)
        elif adapter=='alibaba-bailian':
            rows=parse_bailian(raw,source)
        elif adapter=='tencent-tokenhub':
            rows=parse_tokenhub_dynamics(raw,source)
        elif adapter=='baidu-qianfan':
            rows=parse_qianfan(raw,source)
        elif adapter=='kimi-blog':
            rows=parse_kimi_blog(raw,source)
        elif adapter=='xai-sitemap':
            rows=collect_xai(client,raw,source,now,window_seconds)
        elif adapter=='seed-blog':
            rows=collect_seed(client,raw,source,now,window_seconds)
        elif adapter=='minimax-blog':
            rows=collect_minimax(client,raw,source)
        elif adapter=='huggingface-models':
            rows=parse_huggingface_models(raw,source)
        else:
            rows=parse_feed(raw,source,review)
        if source.get('guard',True):
            guard(source['id'],len(rows))
        for row in rows:
            # Contract §4.5 URL normalization: keep article identity stable and strip tracking parameters.
            row=dict(row,sourceUrl=normalize_url(row['sourceUrl']))
            identity=digest(row['sourceUrl'])
            if identity in known or identity in seen:
                continue
            seen.add(identity)
            age=(now_dt-datetime.fromisoformat(row['publishedAt'])).total_seconds()
            if age < -300:
                review('news-future',identity,'publication is in the future',row)
                continue
            if age > window_seconds:
                continue
            candidates.append((row,official,source))
    machine={}
    if translate:
        pending=[dict(id=digest(row['sourceUrl']),title=row['title'],summary=row.get('summary'))
                 for row,_,_ in candidates if not re.search(r'[\u3400-\u9fff]',row['title'])]
        if pending:
            machine=translate(pending)
    items=[]
    for row,official,source in candidates:
        identity=digest(row['sourceUrl'])
        title=row['title']; originalTitle=None; translatedAt=None; summary=None; lang='zh'
        if not re.search(r'[\u3400-\u9fff]',title):
            translated=machine.get(identity)
            if not translated:
                continue  # retried next run while still inside the admission window
            originalTitle=title; title=translated['title']; summary=translated.get('summary')
            translatedAt=now; lang='en'
        else:
            # 来源自带简介优先（可截断，边界优先，不留断句标点）；缺失时由模型据原文起草。
            source_summary=' '.join((row.get('summary') or '').split())
            if source_summary and re.search(r'[\u3400-\u9fff]',source_summary):
                summary=abstract(source_summary,80) or None
        event=news_event(title,official=official)
        if event is None:
            continue
        if official:
            publisher=source['name']; original=row['sourceUrl']; verified=now
        else:
            publisher,original,verified=verify_original(client,row,originals.get(identity),now,review)
        added=row['publishedAt'] if backfill else now
        items.append(dict(row,id=identity,title=title,originalTitle=originalTitle,translatedAt=translatedAt,
                          summary=summary,lang=lang,originalSource=publisher,originalUrl=original,
                          originalVerifiedAt=verified,url=original or row['sourceUrl'],
                          category=CATEGORY_BY_EVENT[event],eventType=event,addedAt=added))
    # Daily quotas count items admitted on the same Beijing day; normal runs share one
    # budget (today), while the one-off backfill keeps every historical day separate.
    def bj_day(value):
        return (datetime.fromisoformat(value)+timedelta(hours=8)).date().isoformat()
    budget={}
    def slot(day):
        return budget.setdefault(day,dict(total=0,source={},event={}))
    for item in old.get('items',[]):
        current=slot(bj_day(item['addedAt']))
        current['total']+=1
        current['source'][item['source']]=current['source'].get(item['source'],0)+1
        current['event'][item['eventType']]=current['event'].get(item['eventType'],0)+1
    priority={event:index for index,event in enumerate(EVENTS)}
    order=lambda i:(-datetime.fromisoformat(bj_day(i['addedAt'])+'T00:00:00+08:00').timestamp(),
                    priority[i['eventType']],-datetime.fromisoformat(i['publishedAt']).timestamp(),i['id'])
    # 相似排除只比对近 7 天入库的条目，避免长期库存永久压住同型号的后续事件。
    recent=[item for item in old.get('items',[])
            if (now_dt-datetime.fromisoformat(item['addedAt'])).total_seconds()<=7*24*3600]
    chosen=[]
    for item in sorted(items,key=order):
        current=slot(bj_day(item['addedAt']))
        if current['total']>=6:
            continue
        if any(similar_event(item,known) for known in recent):
            continue
        if current['source'].get(item['source'],0)>=2 or current['event'].get(item['eventType'],0)>=2:
            continue
        chosen.append(item)
        recent.append(item)
        current['total']+=1
        current['source'][item['source']]=current['source'].get(item['source'],0)+1
        current['event'][item['eventType']]=current['event'].get(item['eventType'],0)+1
    merged=sorted(old.get('items',[])+chosen,key=news_order)
    if summarize:
        fill_news_summaries(client,merged,summarize)
    return dict(dataUpdatedAt=now,items=merged)


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
