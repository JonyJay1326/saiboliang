"""Offline regression checks; no keys, network, or third-party test runner."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from common import DataError, digest, normalize_url, read_json, write_json
from contract import empty_batch, validate
from pipeline import Run, assemble, load_tickets, lock, main, promote, read_batch, save_candidate
from sources import Tree, aibase_article, collect_aa, collect_evidence_records, collect_github, is_ai, model_data, model_name, news_event, parse_deepseek_news, parse_plan, parse_trending, collect_news

NOW='2026-09-17T11:00:00Z'
LATER='2026-09-17T12:00:00Z'


class FakeClient:
    def __init__(self,pages=None,documents=None):
        self.pages=pages or []
        self.documents=documents or {}

    def json(self,*args):
        return self.pages.pop(0)

    def get(self,url,*args,**kwargs):
        value=self.documents[url]
        if isinstance(value,Exception):
            raise value
        return value.encode(),url


def aa_row(identity='one',score=10,coding=9,name=None,slug=None,price=(1,2)):
    return dict(id=identity,name=name or ('Model '+identity),slug=slug or ('model-'+identity),
                model_creator={'name':'Vendor'},release_date=None,
                pricing={'price_1m_input_tokens':price[0],'price_1m_output_tokens':price[1]},
                evaluations={'artificial_analysis_intelligence_index':score,'artificial_analysis_coding_index':coding})


def page(number,total,row,version=4.3):
    return dict(intelligence_index_version=version,pagination=dict(page=number,total_pages=total,page_size=1,has_more=number<total),data=[row])


class PipelineTests(unittest.TestCase):
    def test_aibase_identity_date_timezone_and_split_flight(self):
        title='千问APP新增保护功能'
        def html(identity=42, published='2026-09-17T17:40:15.1505501+08:00'):
            row=dict(Id=identity,title=title,addtime=published,updtime='2026-09-18T00:00:00+08:00')
            flight='1:T3,abc7:'+json.dumps({'article':row},ensure_ascii=False)+'\n'
            chunks=[flight[:30],flight[30:]]
            return ('<h1>'+title+'</h1>'+''.join('<script>self.__next_f.push('+json.dumps([1,c])+')</script>' for c in chunks)).encode()
        url='https://www.aibase.com/zh/news/42'; source={'name':'AIBase'}
        row=aibase_article(html(),url,source)
        self.assertEqual(row['publishedAt'],'2026-09-17T09:40:15Z')
        self.assertEqual(row['sourceUrl'],url)
        for raw in [html(identity=43),html(published='2026-09-17 17:40:15'),b'<h1>missing data</h1>']:
            with self.assertRaises(ValueError): aibase_article(raw,url,source)

    def test_news_event_real_headlines_and_false_positives(self):
        cases = {
            'Claude双入口合并，原生Office上线！硅谷AI办公大战也开始了': 'major-update',
            'Mistral 与 Mozilla 合作推出 Firefox Smart Window': 'major-update',
            '千问APP升级未成年人保护模式，让青少年安全地用好AI': 'major-update',
            'DeepSeek V4.1 Flash 正式发布：全新模型架构': 'model-release',
            '大会现场，智谱发布 GLM-5.3 模型': 'model-release',
            'DeepSeek V4.1-Flash登陆WorkBuddy，开启限时免费试用': 'price-or-free',
            'Claude API 停止支持旧版本，开发者需迁移': 'action-required',
            '消息称 OpenAI 即将攻克霍奇猜想': None,
            '小米公开MiMo-V2.6大模型RL训练过程 罗福莉发文确认将开源技术细节': None,
            'Claude Code团队讲究啊，这都往外说': None,
            'Mozilla 报告称中国开放权重模型与美国前沿模型仅相差 4.4 个月': None,
            'AI 初创公司启动融资': None,
            'Firefox 156 释出': None,
            'AI 插件安装教程：新增功能详解': None,
        }
        for title, expected in cases.items():
            with self.subTest(title=title):
                self.assertEqual(news_event(title), expected)

    def test_news_event_expanded_topics_and_new_types(self):
        cases = {
            # 新增事件类型
            '实测智象HiDream-O1-Video视频模型：视频生成开始理解真实世界': 'model-review',
            '央企做了个通用Agent，直接杀进IDC实测前三': 'model-review',
            '5999元，努比亚"二代豆包手机"首发深度体验，Agent Phone成了？': 'hands-on',
            '腾讯、字节、阿里会战AI办公之后：Agent领域格局已变': 'deep-analysis',
            '新架构背后的算力与神经网络协同设计': 'deep-analysis',
            # 扩充后的主题词表
            'Codex 与 Grok 在代码生成任务上的对比': None,
            'Kimi 开放平台新增工具调用能力': 'major-update',
            '混元大模型工具链新增多模态能力': 'major-update',
            'MCP 服务端工具调用工作流自动化实践': None,
            '低代码平台接入大语言模型': None,
            # 传闻类必须继续排除
            '神秘模型 Union Alpha 突袭！部分网友实测称性能直逼 Astra': None,
            '据传某厂商即将开源新模型': None,
        }
        for title, expected in cases.items():
            with self.subTest(title=title):
                self.assertEqual(news_event(title), expected)
        # 官方源跳过「发布类动词」要求
        self.assertEqual(news_event('DeepSeek V4.1 Flash：更强、更快、更普惠', official=True), 'model-release')
        self.assertEqual(news_event('DeepSeek V4.1 Flash：更强、更快、更普惠', official=False), None)

    def test_deepseek_official_news_adapter(self):
        html = ('<html><a href="/news/deepseek-v4-1-flash/"><span>动态</span>'
                '<span>2026 年 9 月 10 日</span><h2>DeepSeek V4.1 Flash：更强、更快、更普惠</h2>'
                '<p>描述</p></a>'
                '<a href="/news/v3-2-exp/"><span>动态</span><span>2025 年 9 月 29 日</span>'
                '<h3>DeepSeek-V3.2-Exp 发布</h3></a>'
                '<a href="/news/deepseek-v4-1-flash/"><h2>重复项</h2></a>'
                '<a href="/news/">更多</a></html>')
        source = dict(id='deepseek', name='DeepSeek 官网', url='https://www.deepseek.com/news/')
        rows = parse_deepseek_news(html, source)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]['title'], 'DeepSeek V4.1 Flash：更强、更快、更普惠')
        self.assertEqual(rows[0]['sourceUrl'], 'https://www.deepseek.com/news/deepseek-v4-1-flash/')
        # 北京日 00:00 → UTC 前一日 16:00
        self.assertEqual(rows[0]['publishedAt'], '2026-09-09T16:00:00Z')
        self.assertEqual(rows[1]['publishedAt'], '2025-09-28T16:00:00Z')
        with self.assertRaises(ValueError): parse_deepseek_news('<html>no items</html>', source)

    def test_news_caps_by_source_and_event_type(self):
        def rss(title, host, day):
            return ('<item><title>' + title + '</title><link>https://' + host + '/' + str(abs(hash(title)) % 9999) +
                    '</link><pubDate>Thu, ' + day + ' Sep 2026 09:00:00 +0000</pubDate></item>')
        items = ''.join([
            rss('DeepSeek V4.1 Flash 模型正式发布', 'cn.example', '17'),
            rss('Qwen 4 模型正式发布，能力提升', 'cn.example', '17'),
            rss('GLM-6 模型正式发布，全面开源', 'cn.example', '17'),
            rss('另一个模型正式发布上线', 'other.example', '17'),
        ])
        source = dict(id='cn', name='中文媒体', url='https://cn.example/feed', articleHosts=['cn.example'])
        other = dict(id='other', name='其它媒体', url='https://other.example/feed', articleHosts=['other.example'])
        client = FakeClient(documents={source['url']: '<rss><channel>' + items + '</channel></rss>',
                                       other['url']: '<rss><channel>' + rss('混元模型正式发布上线', 'other.example', '17') + '</channel></rss>'})
        data = collect_news(client, [source, other], {}, NOW, lambda *x: None, lambda *x: None)
        # 同源最多 2 条、同事件类型最多 2 条
        self.assertEqual(len(data['items']), 2)
        self.assertTrue(all(i['eventType'] == 'model-release' for i in data['items']))

    def test_contract_rejects_unknown_fields_and_mixed_versions(self):
        batch=empty_batch(NOW); validate(batch)
        broken=copy.deepcopy(batch); broken['models']['models']=[dict(score=2)]
        with self.assertRaises(ValueError): validate(broken)
        broken=copy.deepcopy(batch); broken['github']['version']=LATER
        with self.assertRaises(ValueError): validate(broken)

    def test_no_change_and_failed_module_preserve_freshness(self):
        old=empty_batch(NOW)
        batch,changed=assemble(old,{},LATER)
        self.assertFalse(changed); self.assertEqual(batch,old)
        data=copy.deepcopy(old['github']); data['dataUpdatedAt']=LATER
        batch,changed=assemble(old,{'github':data},LATER)
        self.assertTrue(changed)
        self.assertIsNone(batch['models']['dataUpdatedAt'])
        self.assertEqual(batch['github']['dataUpdatedAt'],LATER)
        self.assertTrue(all(v['version']==LATER for v in batch.values()))

    def test_same_second_version_monotonic(self):
        old=empty_batch(NOW); data=copy.deepcopy(old['news']); data['dataUpdatedAt']=NOW
        new,_=assemble(old,{'news':data},NOW)
        self.assertGreater(new['version']['version'],NOW)

    def test_aa_complete_pages_and_partial_rejection(self):
        version,rows=collect_aa(FakeClient([page(1,2,aa_row()),page(2,2,aa_row('two'))]),'test')
        self.assertEqual((version,len(rows)),('4.3',2))
        for second in [page(1,2,aa_row('two')),page(2,2,aa_row('two'),4.4),page(2,2,aa_row())]:
            with self.assertRaises(ValueError): collect_aa(FakeClient([page(1,2,aa_row()),second]),'test')

    def test_model_dedup_prices_and_snapshot_identity(self):
        rows=[aa_row('a1',score=15,coding=20,name='Demo One (max)',slug='demo-one',price=(10,50)),
              aa_row('a2',score=12,coding=18,name='Demo One (high)',slug='demo-one-high',price=(10,50)),
              aa_row('a3',score=5,coding=9,name='Demo Two (Nov \'24)',slug='demo-two',price=(None,None)),
              aa_row('a4',score=4,coding=8,name='Demo Two (max)',slug='demo-two-max',price=(0,0))]
        reviews=[]
        data=model_data('4.3',rows,empty_batch(NOW)['models'],NOW,lambda *x:reviews.append(x))
        batch,_=assemble(None,{'models':data},NOW); validate(batch)
        self.assertEqual([m['id'] for m in data['models']],['demo-one','demo-two','demo-two-max'])
        one=next(m for m in data['models'] if m['id']=='demo-one')
        self.assertEqual((one['name'],one['inputCost'],one['outputCost']),( 'Demo One',10.0,50.0))
        self.assertEqual(one['priceSource'],'artificial-analysis')
        self.assertEqual(one['priceSourceUrl'],'https://artificialanalysis.ai/models/demo-one')
        two=next(m for m in data['models'] if m['id']=='demo-two')
        self.assertEqual(two['name'],"Demo Two (Nov '24)")
        self.assertTrue(all(two[k] is None for k in ('inputCost','outputCost','priceSource','priceSourceUrl','priceUpdatedAt')))
        self.assertEqual(model_name('Demo (32B)'),'Demo (32B)')
        self.assertEqual(model_name('Demo (Non-reasoning)'),'Demo')
        self.assertEqual([v['modelId'] for v in data['rankings']['intelligence']],['demo-one','demo-two','demo-two-max'])
        self.assertEqual(len(reviews),0)

    def test_trending_structure_and_filter(self):
        html='<article class="Box-row"><h2><a href="/vendor/tool">vendor/tool</a></h2><p>LLM coding agent</p><a href="/vendor/tool/stargazers">1,234</a><span>15 stars this week</span></article>'
        row=parse_trending(html)[0]
        self.assertEqual((row['stars'],row['periodStars'],row['sourceRank']),(1234,15,1))
        self.assertTrue(is_ai(row,{}))
        self.assertFalse(is_ai(dict(row,description='awesome list of LLM tools'),{}))
        self.assertFalse(is_ai(row,{'vendor/tool':'exclude'}))
        with self.assertRaises(ValueError): parse_trending('<html>rate limit</html>')
        row=parse_trending(html.replace('<span>15 stars this week</span>',''))[0]
        self.assertIsNone(row['periodStars'])

    def test_trending_sponsor_slot_excluded_and_position_kept(self):
        sponsor='<article class="Box-row"><a href="/sponsors/vendor">Sponsor</a><h2><a href="/vendor/ad">vendor/ad</a></h2><p>LLM agent</p><a href="/vendor/ad/stargazers">1,000</a><span>9,999 stars this week</span></article>'
        organic='<article class="Box-row"><h2><a href="/vendor/tool">vendor/tool</a></h2><p>LLM coding agent</p><a href="/vendor/tool/stargazers">1,234</a><span>15 stars this week</span></article>'
        rows=parse_trending('<html>'+sponsor+organic+'</html>')
        self.assertEqual([r['repo'] for r in rows],['vendor/tool'])
        self.assertEqual(rows[0]['sourceRank'],2)
        with self.assertRaises(ValueError): parse_trending('<html>'+sponsor+'</html>')

    def test_github_pages_merge_sort_and_limits(self):
        def card(repo,period):
            return ('<article class="Box-row"><h2><a href="/'+repo+'">'+repo+'</a></h2><p>LLM coding agent</p>'
                    '<a href="/'+repo+'/stargazers">9,000</a><span>'+str(period)+' stars this week</span></article>')
        sponsor='<article class="Box-row"><a href="/sponsors/vendor">Sponsor</a><h2><a href="/vendor/ad">vendor/ad</a></h2><p>LLM agent</p><a href="/vendor/ad/stargazers">1,000</a><span>9,999 stars this week</span></article>'
        base='https://github.com/trending?since=weekly'; lang='https://github.com/trending/python?since=weekly'
        month='https://github.com/trending?since=monthly'; month_lang='https://github.com/trending/python?since=monthly'
        documents={
            base:'<html>'+sponsor+card('vendor/slow',10)+card('vendor/fast',900)+'</html>',
            lang:'<html>'+card('vendor/fast',900)+'</html>',
            month:'<html>'+card('vendor/slow',10)+'</html>',
            month_lang:'<html>'+card('vendor/fast',900)+'</html>',
        }
        data=collect_github(FakeClient(documents=documents),NOW,['python'],{},lambda *x:None,lambda *x:None)
        self.assertEqual([i['repo'] for i in data['week']['items']],['vendor/fast','vendor/slow'])
        self.assertEqual(data['week']['items'][0]['sourceRank'],1)
        self.assertEqual(data['week']['items'][1]['sourceRank'],2)
        self.assertNotIn('vendor/ad',[i['repo'] for i in data['week']['items']])
        self.assertEqual(data['week']['sourceUrl'],base)
        self.assertEqual(data['month']['sourceUrl'],month)
        self.assertEqual(len(data['week']['items']),2)

    def test_github_page_failure_is_isolated(self):
        base='https://github.com/trending?since=weekly'; lang='https://github.com/trending/python?since=weekly'
        month='https://github.com/trending?since=monthly'; month_lang='https://github.com/trending/python?since=monthly'
        card='<article class="Box-row"><h2><a href="/vendor/tool">vendor/tool</a></h2><p>LLM agent</p><a href="/vendor/tool/stargazers">9</a><span>5 stars this week</span></article>'
        reviews=[]
        documents={base:'<html>'+card+'</html>',lang:DataError('HTTP 503'),
                   month:'<html>'+card+'</html>',month_lang:DataError('HTTP 503')}
        data=collect_github(FakeClient(documents=documents),NOW,['python'],{},lambda *x:None,lambda *x:reviews.append(x))
        self.assertEqual([i['repo'] for i in data['week']['items']],['vendor/tool'])
        self.assertEqual([r[0] for r in reviews],['github-page','github-page'])

    def test_github_all_pages_failed(self):
        base='https://github.com/trending?since=weekly'; lang='https://github.com/trending/python?since=weekly'
        documents={base:DataError('HTTP 503'),lang:DataError('HTTP 503')}
        with self.assertRaises(ValueError):
            collect_github(FakeClient(documents=documents),NOW,['python'],{},lambda *x:None,lambda *x:None)

    def test_github_ambiguous_below_cutoff_is_not_queued(self):
        def card(repo,period,desc):
            return ('<article class="Box-row"><h2><a href="/'+repo+'">'+repo+'</a></h2><p>'+desc+'</p>'
                    '<a href="/'+repo+'/stargazers">9,000</a><span>'+str(period)+' stars this week</span></article>')
        confirmed=''.join(card('vendor/tool'+str(i),100-i,'LLM coding agent') for i in range(12))
        near=card('vendor/near',95,'A small utility for teams')
        far=card('vendor/far',50,'A small utility for teams')
        base='https://github.com/trending?since=weekly'; month='https://github.com/trending?since=monthly'
        documents={base:'<html>'+confirmed+near+far+'</html>',month:'<html>'+confirmed+'</html>'}
        reviews=[]
        data=collect_github(FakeClient(documents=documents),NOW,[],{},lambda *x:None,lambda *x:reviews.append(x))
        queued=[r[1] for r in reviews]
        self.assertIn('vendor/near',queued)
        self.assertNotIn('vendor/far',queued)
        self.assertEqual(len(data['week']['items']),10)
        self.assertEqual(data['week']['items'][0]['periodStars'],100)

    def test_url_identity_and_credential_rejection(self):
        self.assertEqual(normalize_url('https://EXAMPLE.com:443/Path/?b=2&utm_source=x&a=1#top'),'https://example.com/Path/?a=1&b=2')
        self.assertNotEqual(normalize_url('https://example.com/Path'),normalize_url('https://example.com/path'))
        with self.assertRaises(ValueError): normalize_url('https://user:pass@example.com/x')

    def test_news_expiry_future_caps_and_fallback(self):
        items=''.join('<item><title>新模型正式发布'+str(i)+'</title><link>https://cn.example/'+str(i)+'</link><pubDate>'+date+'</pubDate></item>' for i,date in enumerate([
            'Thu, 17 Sep 2026 09:00:00 +0000','Thu, 17 Sep 2026 10:00:00 +0000','Thu, 17 Sep 2026 08:00:00 +0000',
            'Thu, 17 Sep 2026 12:00:00 +0000','Mon, 14 Sep 2026 09:00:00 +0000']))
        source=dict(id='cn',name='中文媒体',url='https://cn.example/feed',articleHosts=['cn.example'])
        reviews=[]
        data=collect_news(FakeClient(documents={source['url']:'<rss><channel>'+items+'</channel></rss>'}),[source],{},NOW,lambda *x:None,lambda *x:reviews.append(x))
        self.assertEqual(len(data['items']),2)
        self.assertEqual(data['items'][0]['sourceUrl'],'https://cn.example/1')
        self.assertIsNone(data['items'][0]['originalUrl'])
        self.assertEqual(data['items'][0]['url'],data['items'][0]['sourceUrl'])
        self.assertEqual(len(reviews),1)
        batch,_=assemble(None,{'news':data},NOW); validate(batch)
        # A stale retained module is checked against its actual collection time.
        later,_=assemble(batch,{'github':dict(batch['github'],dataUpdatedAt='2026-09-21T11:00:00Z')},'2026-09-21T11:00:00Z')
        validate(later)

    def test_original_verified_and_revalidation_failure(self):
        source=dict(id='cn',name='中文媒体',url='https://cn.example/feed',articleHosts=['cn.example'])
        article='https://cn.example/1'; official='https://vendor.example/releases/1'
        feed='<rss><channel><item><title>新模型正式发布</title><link>'+article+'</link><pubDate>Thu, 17 Sep 2026 09:00:00 +0000</pubDate></item></channel></rss>'
        documents={source['url']:feed,article:'<p>发布模型一</p><a href="'+official+'">官方公告</a>',official:'<h1>Model One Released</h1>'}
        mapping={digest(normalize_url(article)):dict(url=official,publisher='Vendor',articleEvidence='发布模型一',originalEvidence='Model One Released',eventSpecific=True)}
        data=collect_news(FakeClient(documents=documents),[source],mapping,NOW,lambda *x:None,lambda *x:None)
        self.assertEqual(data['items'][0]['url'],official)
        documents[official]='<h1>Homepage</h1>'
        data=collect_news(FakeClient(documents=documents),[source],mapping,NOW,lambda *x:None,lambda *x:None)
        self.assertEqual(data['items'][0]['url'],article)

    def test_news_tracking_parameters_stripped_from_source_url(self):
        item='<item><title>新模型正式发布</title><link>https://cn.example/story?utm_source=rss&amp;utm_medium=feed&amp;p=7</link><pubDate>Thu, 17 Sep 2026 09:00:00 +0000</pubDate></item>'
        source=dict(id='cn',name='中文媒体',url='https://cn.example/feed',articleHosts=['cn.example'])
        data=collect_news(FakeClient(documents={source['url']:'<rss><channel>'+item+'</channel></rss>'}),[source],{},NOW,lambda *x:None,lambda *x:None)
        self.assertEqual(data['items'][0]['sourceUrl'],'https://cn.example/story?p=7')
        self.assertEqual(data['items'][0]['id'],digest('https://cn.example/story?p=7'))
        batch,_=assemble(None,{'news':data},NOW); validate(batch)

    def test_review_dedup_and_pre_filter_drop_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            run=Run(Path(tmp),NOW)
            for _ in range(2): run.review('source','aa','bad',{})
            self.assertEqual(len(run.queue),1)
            run.health={'aa':{'count':100}}
            run.guard('aa',60)
            with self.assertRaises(ValueError): run.guard('aa',59)

    def test_review_queue_retires_only_for_succeeded_modules(self):
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp)
            seed=[dict(kind='github-classification',objectId='vendor/stale',reason='AI applicability uncertain',evidence={},id='a',status='pending',createdAt=NOW),
                  dict(kind='news-future',objectId='b',reason='future',evidence={},id='b',status='pending',createdAt=NOW),
                  dict(kind='source',objectId='github',reason='HTTP 503',evidence={},id='c',status='pending',createdAt=NOW)]
            write_json(state/'review-queue.json',seed)
            # A partial run touching only news retires its own stale item, never github's.
            run=Run(state,NOW); run.success=['news']; run.save()
            self.assertEqual({i['id'] for i in read_json(state/'review-queue.json')},{'a','c'})
            self.assertEqual(read_json(state/'run.json')['retired'],1)
            # A module that did not run leaves its entries untouched.
            run=Run(state,NOW); run.success=['models']; run.save()
            self.assertEqual({i['id'] for i in read_json(state/'review-queue.json')},{'a','c'})
            # A failed module keeps its entries even though the run reached save().
            run=Run(state,NOW); run.errors={'github':'HTTP 503'}; run.save()
            self.assertEqual({i['id'] for i in read_json(state/'review-queue.json')},{'a','c'})
            # Success without re-raising retires the classification item and the old failure note.
            run=Run(state,NOW); run.success=['github']; run.save()
            self.assertEqual(read_json(state/'review-queue.json'),[])
            self.assertEqual(read_json(state/'run.json')['retired'],2)

    def test_plan_price_extraction_and_semantic_fingerprint(self):
        def document(price='10',period='month'):
            return Tree('<main><p>Billing conditions unchanged</p><table><tr><th>Plan</th><th>Pricing</th><th>GitHub AI Credits</th><th>Agents</th><th>Models</th></tr></table><table><tr>'+''.join('<th>'+h+'</th>' for h in ['Plan','Price per '+period,'Base credits','Flex allotment','Total monthly AI credits'])+'</tr>'+''.join('<tr><td>'+n+'</td><td>$'+price+' USD</td><td>1,000</td><td>500</td><td>1,500</td></tr>' for n in ['Copilot Pro','Copilot Pro+','Copilot Max'])+'</table></main>').root
        data,fingerprint=parse_plan(document(),{},'copilot-plans')
        newer,newfingerprint=parse_plan(document('12'),{},'copilot-plans')
        self.assertEqual(data['tiers'][0]['price'],10)
        self.assertEqual(newer['tiers'][0]['price'],12)
        self.assertEqual(fingerprint,newfingerprint)
        with self.assertRaises(ValueError): parse_plan(document(period='year'),{},'copilot-plans')

    def test_bad_official_evidence_never_refreshes_a_record(self):
        record=dict(id='plan',vendor='Vendor',product='Coding',group='overseas',tagline=None,highlights=[],quotaBasis=None,supportedTools=['CLI'],modelIds=[],status='available',sourceUrl='https://vendor.example/plan',updatedAt='2026-09-16',checkMethod='auto',tiers=[dict(name='Pro',price=10,currency='USD',period='month',offerType='standard',note=None,features=['100 credits'],conditions='Individual subscription')])
        config=dict(record=record,approved=True,scope={'tag':'main','attrs':{}},evidenceHash=digest('100 credits'),evidenceText=['100 credits'])
        client=FakeClient(documents={record['sourceUrl']:'<main>Sold out</main>'})
        reviews=[]
        with self.assertRaises(ValueError): collect_evidence_records(client,[config],[record],NOW,lambda *x:reviews.append(x))
        self.assertEqual(record['updatedAt'],'2026-09-16')
        self.assertEqual(len(reviews),1)

    def test_manual_ticket_file_stamps_validation_and_duration_rule(self):
        with tempfile.TemporaryDirectory() as tmp:
            editorial=Path(tmp)/'editorial'
            ticket=dict(id='demo-free-202609',title='示例免费额度',vendor='示例厂商',category='api-quota',score=59,
                        tags=dict(duration='longterm',region='cn'),expired=False,expiryDate=None,
                        summary='注册即用免绑卡',content='正文说明',link='https://vendor.example/free',
                        affiliate=False,publishedAt='2026-09-10',updatedAt='2026-09-10')
            write_json(editorial/'tickets.json',[ticket])
            data=load_tickets(editorial,{},NOW)
            batch,_=assemble(None,{'tickets':data},NOW); validate(batch)
            self.assertFalse(data['tickets'][0]['affiliate'])
            self.assertEqual(data['dataUpdatedAt'],NOW)
            self.assertEqual(load_tickets(editorial,data,LATER)['dataUpdatedAt'],NOW)
            for broken in [dict(ticket,images=[]),dict(ticket,score=101),dict(ticket,category='plan')]:
                write_json(editorial/'tickets.json',[broken])
                with self.assertRaises(ValueError): load_tickets(editorial,{},NOW)
            dated=dict(ticket,expiryDate='2026-10-01T23:59:59+08:00')
            with self.assertRaises(ValueError): assemble(None,{'tickets':dict(dataUpdatedAt=NOW,tickets=[dated])},NOW)
            limited=dict(ticket,expiryDate='2026-10-01T23:59:59+08:00',tags=dict(duration='limited',region='cn'))
            validate(assemble(None,{'tickets':dict(dataUpdatedAt=NOW,tickets=[limited])},NOW)[0])

    def test_all_source_failure_does_not_publish_or_refresh(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); output=root/'data'; editorial=root/'editorial'
            save_candidate(output,empty_batch(NOW))
            write_json(editorial/'sources.json',dict(github=['python'],news=[],plans=[]))
            write_json(editorial/'overrides.json',dict(github={},records=[]))
            args=['collect','--modules','github','--output',str(output),'--state',str(root/'state'),'--editorial',str(editorial),'--candidate',str(root/'candidate')]
            with patch('pipeline.collect_github',side_effect=DataError('HTTP 503')):
                self.assertEqual(main(args),1)
            self.assertEqual(read_batch(output),empty_batch(NOW))
            self.assertFalse((root/'candidate').exists())

    def test_local_transaction_and_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); output=root/'data'; candidate=root/'candidate'
            save_candidate(candidate,empty_batch(NOW)); promote(candidate,output)
            self.assertEqual(read_batch(output),empty_batch(NOW))
            save_candidate(candidate,empty_batch(LATER))
            original=Path.rename
            def fail_next(path,target):
                if path.name=='data.next': raise OSError('simulated interruption')
                return original(path,target)
            with patch.object(Path,'rename',fail_next):
                with self.assertRaises(OSError): promote(candidate,output)
            self.assertEqual(read_batch(output),empty_batch(NOW))
            with lock(root/'collect.lock'):
                with self.assertRaises(ValueError):
                    with lock(root/'collect.lock'): pass

    def test_build_failure_leaves_public_batch_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); output=root/'data'; state=root/'state'; editorial=root/'editorial'; candidate=root/'candidate'
            save_candidate(output,empty_batch(NOW))
            write_json(editorial/'sources.json',dict(github=['python'],news=[],plans=[]))
            write_json(editorial/'overrides.json',dict(github={},records=[]))
            gh=empty_batch(LATER)['github']; gh['dataUpdatedAt']=LATER
            argv=['collect','--modules','github','--output',str(output),'--state',str(state),'--editorial',str(editorial),'--candidate',str(candidate),'--build-command','fake-build']
            with patch('pipeline.collect_github',return_value=gh),patch('pipeline.utcnow',return_value=LATER),patch('pipeline.subprocess.run') as build:
                build.return_value.returncode=1
                self.assertEqual(main(argv),1)
            self.assertEqual(read_batch(output),empty_batch(NOW))
            self.assertEqual(read_json_for_test(state/'source-health.json'),{})


def read_json_for_test(path):
    return json.loads(path.read_text(encoding='utf-8'))


if __name__=='__main__':
    unittest.main()
