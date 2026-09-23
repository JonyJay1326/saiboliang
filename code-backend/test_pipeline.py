"""Offline regression checks; no keys, network, or third-party test runner."""
import copy
import gzip
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from common import DataError, decompress, digest, load_key, normalize_url, read_json, write_json
from contract import empty_batch, validate
from pipeline import Run, assemble, load_tickets, lock, main, promote, read_batch, save_candidate
from sources import Tree, abstract, aibase_article, article_excerpt, beijing_day, collect_aa, collect_aibase, collect_aibase_backfill, collect_evidence_records, collect_github, is_ai, meta_description, model_data, model_name, news_event, parse_deepseek_news, parse_feed, parse_plan, parse_trending, collect_news, fill_news_summaries, select_featured, summarize_news, translate_github, translate_news, parse_anthropic_news, collect_xai, collect_seed, collect_minimax, parse_huggingface_models, parse_zhipu_news, parse_tencent_announcements, parse_bailian, parse_tokenhub_dynamics, parse_qianfan, parse_kimi_blog, clip, news_featured_exclusions

NOW='2026-09-17T11:00:00Z'
LATER='2026-09-17T12:00:00Z'


class FakeClient:
    def __init__(self,pages=None,documents=None,posts=None,redirects=None):
        self.pages=pages or []
        self.documents=documents or {}
        self.posts=posts or []
        self.redirects=redirects or {}
        self.sent=[]

    def json(self,*args):
        return self.pages.pop(0)

    def get(self,url,*args,**kwargs):
        value=self.documents[url]
        if isinstance(value,Exception):
            raise value
        return value.encode(),self.redirects.get(url,url)

    def post(self,url,body,headers=None,deadline=None):
        self.sent.append((url,body,headers))
        value=self.posts.pop(0)
        if isinstance(value,Exception):
            raise value
        return json.dumps(value,ensure_ascii=False).encode()


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

    def test_news_event_official_previews_exclusions_and_topic_trim(self):
        # 官方预告不算已发布；「已/正式/现已」加发布动词按发布处理。
        self.assertEqual(news_event('GPT-5.5 将于 10 月发布，支持更长上下文', official=True), 'upcoming')
        self.assertEqual(news_event('Gemini 4 即将推出', official=True), 'upcoming')
        self.assertEqual(news_event('GPT-6 已正式发布，现已可用', official=True), 'model-release')
        # 弃用/下线公告按需用户行动处理。
        self.assertEqual(news_event('GitHub Copilot 弃用模型将在 10 月中旬到来', official=True), 'action-required')
        # 仅主题命中的官方内容不发布；融资、客户案例仍然排除。
        self.assertEqual(news_event('介绍我们的 AI 安全研究方法', official=True), None)
        self.assertEqual(news_event('我们报告模型失准的框架', official=True), None)
        self.assertEqual(news_event('Cooley 借助 ChatGPT 加速 IPO 工作', official=True), None)
        self.assertEqual(news_event('Cooley 如何用 ChatGPT 加速 IPO 工作', official=True), None)
        self.assertEqual(news_event('Anthropic 完成新一轮融资', official=True), None)
        # 媒体源仍排除预告。
        self.assertEqual(news_event('GPT-5.5 将于 10 月发布，支持更长上下文'), None)
        # 已删除的非 AI 主题词不再放行。
        self.assertEqual(news_event('低代码平台正式发布新版本'), None)
        self.assertEqual(news_event('数据可视化工具上线 3.0'), None)
        # 字节 Seed 家族模型名已纳入主题词表。
        self.assertEqual(news_event('Seed3D 2.0 发布，更高精度、更强可用性', official=True), 'model-release')
        # 品牌名紧贴数字的型号名同样命中（Qwen3.8/GPT5），OpenAI/AIGC 仍不误命中 AI。
        self.assertEqual(news_event('阿里发布 Qwen3.8-Omni-Flash：原生全模态', official=True), 'model-release')
        self.assertEqual(news_event('OpenAI 发布 GPT5.6 模型', official=True), 'model-release')
        self.assertEqual(news_event('OpenAI updates its platform', official=True), None)
        self.assertEqual(news_event('AIGC 工具正式上线', official=True), 'major-update')

    def test_parse_feed_atom_and_language_rules(self):
        atom=('<feed xmlns="http://www.w3.org/2005/Atom">'
              '<entry><title>Introducing GPT-6 Astra</title>'
              '<link rel="alternate" href="https://vendor.example/releases/gpt-6"/>'
              '<published>2026-09-17T09:00:00Z</published>'
              '<summary>OpenAI introduces a new reasoning model.</summary></entry></feed>')
        source=dict(id='vendor',name='厂商官方',url='https://vendor.example/feed',official=True,lang='en',articleHosts=['vendor.example'])
        rows=parse_feed(atom,source,lambda *x:None)
        self.assertEqual(rows[0]['sourceUrl'],'https://vendor.example/releases/gpt-6')
        self.assertEqual(rows[0]['publishedAt'],'2026-09-17T09:00:00Z')
        self.assertEqual(rows[0]['summary'],'OpenAI introduces a new reasoning model.')
        with self.assertRaises(ValueError): parse_feed(atom,dict(source,lang='zh'),lambda *x:None)

    def test_news_official_first_party_item_fields(self):
        feed=('<rss><channel><item><title>GLM-5.4 将于 10 月发布</title>'
              '<link>https://vendor.example/upcoming</link>'
              '<pubDate>Thu, 17 Sep 2026 09:00:00 +0000</pubDate></item></channel></rss>')
        source=dict(id='vendor',name='示例厂商官方',url='https://vendor.example/feed',official=True,lang='zh',articleHosts=['vendor.example'])
        data=collect_news(FakeClient(documents={source['url']:feed}),[source],{}, {}, NOW,lambda *x:None,lambda *x:None)
        item=data['items'][0]
        self.assertEqual(item['eventType'],'upcoming')
        self.assertEqual(item['category'],'industry')
        self.assertEqual(item['source'],'示例厂商官方')
        self.assertEqual(item['sourceUrl'],item['originalUrl'])
        self.assertEqual(item['url'],item['sourceUrl'])
        self.assertEqual(item['originalVerifiedAt'],NOW)
        self.assertEqual(item['lang'],'zh')
        self.assertIsNone(item['originalTitle'])
        self.assertEqual(item['addedAt'],NOW)
        batch,_=assemble(None,{'news':data},NOW); validate(batch)

    def test_news_translation_flow_and_retry(self):
        feed=('<rss><channel><item><title>Introducing GPT-6 Astra</title>'
              '<link>https://vendor.example/gpt-6</link>'
              '<pubDate>Thu, 17 Sep 2026 09:00:00 +0000</pubDate>'
              '<description>OpenAI introduces a new reasoning model.</description></item></channel></rss>')
        source=dict(id='vendor',name='示例厂商官方',url='https://vendor.example/feed',official=True,lang='en',articleHosts=['vendor.example'])
        identity=digest(normalize_url('https://vendor.example/gpt-6'))
        def translate(items):
            self.assertEqual([i['id'] for i in items],[identity])
            self.assertEqual(items[0]['summary'],'OpenAI introduces a new reasoning model.')
            return {identity:{'title':'OpenAI 发布 GPT-6 Astra','summary':'OpenAI 发布新的推理模型。'}}
        data=collect_news(FakeClient(documents={source['url']:feed}),[source],{}, {}, NOW,lambda *x:None,lambda *x:None,translate)
        item=data['items'][0]
        self.assertEqual(item['title'],'OpenAI 发布 GPT-6 Astra')
        self.assertEqual(item['originalTitle'],'Introducing GPT-6 Astra')
        self.assertEqual(item['translatedAt'],NOW)
        self.assertEqual(item['lang'],'en')
        self.assertEqual(item['summary'],'OpenAI 发布新的推理模型。')
        batch,_=assemble(None,{'news':data},NOW); validate(batch)
        # 机译不可用时英文条目不入库，也不阻塞其它来源（下一轮重试）。
        empty=collect_news(FakeClient(documents={source['url']:feed}),[source],{}, {}, NOW,lambda *x:None,lambda *x:None,lambda items:{})
        self.assertEqual(empty['items'],[])
        skipped=collect_news(FakeClient(documents={source['url']:feed}),[source],{}, {}, NOW,lambda *x:None,lambda *x:None)
        self.assertEqual(skipped['items'],[])

    def test_news_accumulation_daily_quota_and_order(self):
        def item(identity,published,source='其他厂商官方',event='major-update',featured=True):
            url='https://vendor.example/'+identity
            return dict(id=digest(url),title='产品重要更新',originalTitle=None,translatedAt=None,summary=None,lang='zh',
                        source=source,sourceUrl=url,originalSource=source,originalUrl=url,originalVerifiedAt=NOW,url=url,
                        publishedAt=published,addedAt=NOW,category='tool',eventType=event,featured=featured)
        old=dict(dataUpdatedAt=NOW,items=[item('a','2026-09-17T08:00:00Z'),item('b','2026-09-17T07:00:00Z')])
        feed=('<rss><channel>'
              '<item><title>新模型正式发布三</title><link>https://vendor.example/c</link><pubDate>Thu, 17 Sep 2026 10:00:00 +0000</pubDate></item>'
              '<item><title>新模型正式发布一</title><link>https://vendor.example/a</link><pubDate>Thu, 17 Sep 2026 08:00:00 +0000</pubDate></item>'
              '</channel></rss>')
        source=dict(id='vendor',name='示例厂商官方',url='https://vendor.example/feed',official=True,lang='zh',articleHosts=['vendor.example'])
        data=collect_news(FakeClient(documents={source['url']:feed}),[source],{},old,NOW,lambda *x:None,lambda *x:None)
        # 已入库 id 不重复收录；新条目与库存合并后按 publishedAt 倒序。
        url=lambda name:'https://vendor.example/'+name
        self.assertEqual([i['sourceUrl'] for i in data['items']],[url('c'),url('a'),url('b')])
        # 当日额度用尽后不再新增（每日上限 20）。
        events=['model-release','major-update','price-or-free']
        full=dict(dataUpdatedAt=NOW,items=[item('%02d'%i,'2026-09-17T%02d:00:00Z'%(i%11),
                                              source='厂商%d'%(i%4),event=events[i%3]) for i in range(20)])
        data=collect_news(FakeClient(documents={source['url']:feed}),[source],{},full,NOW,lambda *x:None,lambda *x:None)
        self.assertEqual(len(data['items']),20)

    def test_news_translate_cache_failure_and_prune(self):
        item=dict(id='a1',title='Introducing GPT-6',summary='A new model.')
        reply=dict(choices=[dict(message=dict(content=json.dumps({'a1':{'title':'OpenAI 发布 GPT-6','summary':'新模型。'}},ensure_ascii=False)))])
        client=FakeClient(posts=[reply]); cache={}; reviews=[]
        result=translate_news(client,[item],cache,'k',NOW,lambda *x:reviews.append(x))
        self.assertEqual(result['a1']['title'],'OpenAI 发布 GPT-6')
        self.assertEqual(cache['a1']['source'],'deepseek-flash')
        client.posts=[]; reviews=[]
        translate_news(client,[item],cache,'k',NOW,lambda *x:reviews.append(x))
        self.assertEqual(client.posts,[])
        # 非法译文（无中文）不写入缓存并记一次待复核。
        bad=dict(choices=[dict(message=dict(content=json.dumps({'a1':{'title':'same text'}})))])
        cache={}; reviews=[]
        translate_news(FakeClient(posts=[bad]),[item],cache,'k',NOW,lambda *x:reviews.append(x))
        self.assertEqual(cache,{}); self.assertEqual(len(reviews),1)

    def test_meta_description_and_article_excerpt(self):
        page=('<html><head><meta name="description" content="新一代同声传译大模型，延迟降至 2.3 秒。">'
              '<meta property="og:description" content="第二顺位"></head><body><p>正文</p></body></html>')
        self.assertEqual(meta_description(page),'新一代同声传译大模型，延迟降至 2.3 秒。')
        self.assertIsNone(meta_description('<html><head></head></html>'))
        client=FakeClient(documents={'https://vendor.example/a':page})
        self.assertEqual(article_excerpt(client,'https://vendor.example/a',None),'新一代同声传译大模型，延迟降至 2.3 秒。')
        snippet=FakeClient(documents={'https://vendor.example/b':'<html><body><p>只有正文片段。</p></body></html>'})
        self.assertEqual(article_excerpt(snippet,'https://vendor.example/b',None),'只有正文片段。')

    def test_news_keeps_source_summary_and_drafts_missing(self):
        long_summary=('新一代同声传译大模型在翻译质量、延迟、说话人识别和语音合成四个维度全面升级，'
                      '字均延迟从上一代的 2.8 秒压缩至 2.3 秒，并新增实时说话人分离能力。')
        feed=('<rss><channel>'
              '<item><title>千问发布 Qwen3.8-LiveTranslate 同传模型</title><link>https://vendor.example/qwen</link>'
              '<pubDate>Thu, 17 Sep 2026 09:00:00 +0000</pubDate><description>'+long_summary+'</description></item>'
              '<item><title>GLM-5.4 正式发布</title><link>https://vendor.example/glm</link>'
              '<pubDate>Thu, 17 Sep 2026 08:00:00 +0000</pubDate></item>'
              '</channel></rss>')
        source=dict(id='vendor',name='示例厂商官方',url='https://vendor.example/feed',official=True,lang='zh',articleHosts=['vendor.example'])
        pages={source['url']:feed,
               'https://vendor.example/glm':'<html><head><meta name="description" content="智谱发布 GLM-5.4 模型，上下文更长。"></head></html>'}
        drafts=[]
        def summarize(items):
            drafts.extend(items)
            return {i['id']:'智谱发布 GLM-5.4，上下文窗口更长。' for i in items}
        data=collect_news(FakeClient(documents=pages),[source],{}, {}, NOW,lambda *x:None,lambda *x:None,summarize=summarize)
        by_url={i['sourceUrl']:i for i in data['items']}
        self.assertEqual(len(by_url),2)
        kept=by_url['https://vendor.example/qwen']['summary']
        self.assertLessEqual(len(kept),80)
        self.assertTrue(kept.startswith('新一代同声传译大模型'))
        self.assertEqual(by_url['https://vendor.example/glm']['summary'],'智谱发布 GLM-5.4，上下文窗口更长。')
        self.assertEqual([i['id'] for i in drafts],[by_url['https://vendor.example/glm']['id']])
        batch,_=assemble(None,{'news':data},NOW); validate(batch)

    def test_news_backfill_window_and_added_at(self):
        feed=('<rss><channel>'
              '<item><title>旧模型正式发布一</title><link>https://vendor.example/old</link>'
              '<pubDate>Sun, 13 Sep 2026 09:00:00 +0000</pubDate></item>'
              '<item><title>新模型正式发布二</title><link>https://vendor.example/new</link>'
              '<pubDate>Thu, 17 Sep 2026 09:00:00 +0000</pubDate></item>'
              '</channel></rss>')
        source=dict(id='vendor',name='示例厂商官方',url='https://vendor.example/feed',official=True,lang='zh',articleHosts=['vendor.example'])
        def client():
            return FakeClient(documents={source['url']:feed})
        normal=collect_news(client(),[source],{}, {}, NOW,lambda *x:None,lambda *x:None)
        self.assertEqual([i['sourceUrl'] for i in normal['items']],['https://vendor.example/new'])
        back=collect_news(client(),[source],{}, {}, NOW,lambda *x:None,lambda *x:None,
                          window_seconds=7*24*3600,backfill=True)
        by_url={i['sourceUrl']:i for i in back['items']}
        self.assertEqual(len(by_url),2)
        self.assertEqual(by_url['https://vendor.example/old']['addedAt'],'2026-09-13T09:00:00Z')
        self.assertEqual(by_url['https://vendor.example/new']['addedAt'],'2026-09-17T09:00:00Z')
        batch,_=assemble(None,{'news':back},NOW); validate(batch)

    def test_aibase_backfill_walks_older_ids(self):
        def html(identity,title,published):
            row=dict(Id=identity,title=title,addtime=published,updtime='2026-09-18T00:00:00+08:00')
            flight='1:T3,abc7:'+json.dumps({'article':row},ensure_ascii=False)+'\n'
            return '<h1>'+title+'</h1><script>self.__next_f.push('+json.dumps([1,flight])+')</script>'
        docs={
            'https://www.aibase.com/zh/news/102':html(102,'窗口内新条','2026-09-17T10:00:00+08:00'),
            'https://www.aibase.com/zh/news/101':html(101,'窗口外旧条','2026-09-01T10:00:00+08:00'),
            'https://www.aibase.com/zh/news/100':html(100,'窗口内旧条','2026-09-15T10:00:00+08:00'),
        }
        rows=[dict(title='列表最新',sourceUrl='https://www.aibase.com/zh/news/103',source='AIBase',summary=None,
                   publishedAt='2026-09-17T11:00:00Z')]
        found=collect_aibase_backfill(FakeClient(documents=docs),rows,{'name':'AIBase'},datetime.fromisoformat(NOW),72*3600)
        self.assertEqual([r['sourceUrl'] for r in found],
                         ['https://www.aibase.com/zh/news/102','https://www.aibase.com/zh/news/100'])
        self.assertTrue(all(r['source']=='AIBase' for r in found))

    def test_news_isolates_a_failing_source(self):
        feed=('<rss><channel><item><title>示例模型正式发布</title><link>https://vendor.example/a</link>'
              '<pubDate>Thu, 17 Sep 2026 09:00:00 +0000</pubDate></item></channel></rss>')
        good=dict(id='good',name='示例厂商官方',url='https://vendor.example/feed',official=True,lang='zh',articleHosts=['vendor.example'])
        bad=dict(id='bad',name='坏源',url='https://bad.example/feed')
        reviews=[]
        data=collect_news(FakeClient(documents={good['url']:feed}),[bad,good],{}, {}, NOW,
                          lambda *x:None,lambda *x:reviews.append(x))
        # 单源失败只跳过该源：其余源照常入库，并记一条待确认（对象为源 id）。
        self.assertEqual(len(data['items']),1)
        self.assertEqual(data['items'][0]['source'],'示例厂商官方')
        self.assertEqual([(r[0],r[1]) for r in reviews],[('news-source','bad')])
        # 全部源失败才按模块失败处理（上层保留整份旧文件）。
        with self.assertRaises(ValueError):
            collect_news(FakeClient(),[bad],{}, {}, NOW,lambda *x:None,lambda *x:None)

    def test_news_summary_generation_cache_and_review(self):
        item=dict(id='a1',title='示例标题',text='来源片段')
        reply=dict(choices=[dict(message=dict(content=json.dumps({'a1':{'summary':'一句中文简介。'}},ensure_ascii=False)))])
        cache={}; reviews=[]
        result=summarize_news(FakeClient(posts=[reply]),[item],cache,'k',NOW,lambda *x:reviews.append(x))
        self.assertEqual(result['a1'],'一句中文简介。')
        self.assertEqual(cache['a1']['source'],'deepseek-flash')
        idle=FakeClient(posts=[])
        summarize_news(idle,[item],cache,'k',NOW,lambda *x:reviews.append(x))
        self.assertEqual(idle.posts,[])
        bad=dict(choices=[dict(message=dict(content=json.dumps({'a1':{'summary':'english only'}})))])
        cache={}; reviews=[]
        summarize_news(FakeClient(posts=[bad]),[item],cache,'k',NOW,lambda *x:reviews.append(x))
        self.assertEqual(cache,{})
        self.assertEqual(len(reviews),1)

    def test_fill_news_summaries_skips_articles_with_summary_and_catalog_urls(self):
        items=[dict(id='a',title='甲',summary='已有简介',url='https://vendor.example/a'),
               dict(id='b',title='乙',summary=None,url='https://vendor.example/catalog?row=1'),
               dict(id='c',title='丙',summary=None,url='https://vendor.example/c')]
        pages={'https://vendor.example/c':'<html><head><meta name="description" content="丙的来源片段。"></head></html>'}
        seen=[]
        def summarize(pending):
            seen.extend(pending)
            return {i['id']:'丙的模型简介。' for i in pending}
        filled=fill_news_summaries(FakeClient(documents=pages),items,summarize)
        self.assertEqual(filled,1)
        self.assertEqual(items[0]['summary'],'已有简介')
        self.assertIsNone(items[1]['summary'])
        self.assertEqual(items[2]['summary'],'丙的模型简介。')
        self.assertEqual([i['id'] for i in seen],['c'])

    def test_validate_news_translation_pairing_and_daily_limits(self):
        url='https://vendor.example/a'
        base=dict(id=digest(url),title='新模型正式发布',originalTitle=None,translatedAt=None,summary=None,lang='zh',
                  source='示例厂商官方',sourceUrl=url,originalSource='示例厂商官方',originalUrl=url,originalVerifiedAt=NOW,
                  url=url,publishedAt='2026-09-17T08:00:00Z',addedAt=NOW,category='model',eventType='model-release',featured=None)
        batch=assemble(None,{'news':dict(dataUpdatedAt=NOW,items=[base])},NOW)[0]; validate(batch)
        for broken in [dict(base,lang='en'),dict(base,lang='en',originalTitle='Original'),dict(base,translatedAt=NOW),
                       dict(base,featured=False)]:
            with self.assertRaises(ValueError): assemble(None,{'news':dict(dataUpdatedAt=NOW,items=[broken])},NOW)
        events=['action-required','model-release','major-update','price-or-free','upcoming','model-review','hands-on','deep-analysis']
        def row(i, **extra):
            item_url='https://vendor.example/%d'%i
            values=dict(id=digest(item_url),source='厂商%d'%i,eventType=events[i%len(events)],
                        sourceUrl=item_url,originalUrl=item_url,url=item_url)
            values.update(extra)
            return dict(base,**values)
        # 每日新增上限 20：20 条通过，21 条被拒。
        rows=[row(i) for i in range(21)]
        validate(assemble(None,{'news':dict(dataUpdatedAt=NOW,items=sorted(rows[:20],key=lambda i:i['id']))},NOW)[0])
        with self.assertRaises(ValueError): assemble(None,{'news':dict(dataUpdatedAt=NOW,items=sorted(rows,key=lambda i:i['id']))},NOW)
        # 每来源 ≤5/天、每事件类型 ≤5/天。
        with self.assertRaises(ValueError):
            assemble(None,{'news':dict(dataUpdatedAt=NOW,items=sorted([row(i,source='厂商A') for i in range(6)],key=lambda i:i['id']))},NOW)
        with self.assertRaises(ValueError):
            assemble(None,{'news':dict(dataUpdatedAt=NOW,items=sorted([row(i,eventType='major-update',source='厂商%d'%i) for i in range(6)],key=lambda i:i['id']))},NOW)
        # 每日精选上限 8：同一天 8 条 featured 通过、9 条被拒。
        validate(assemble(None,{'news':dict(dataUpdatedAt=NOW,items=sorted([row(i,featured=True) for i in range(8)],key=lambda i:i['id']))},NOW)[0])
        with self.assertRaises(ValueError):
            assemble(None,{'news':dict(dataUpdatedAt=NOW,items=sorted([row(i,featured=True) for i in range(9)],key=lambda i:i['id']))},NOW)

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

    def test_anthropic_news_list_adapter(self):
        html=('<section><ul>'
              '<li><a href="/news/accenture-embedded-evaluation" class="listItem"><div class="meta">'
              '<time class="date body-3">Sep 18, 2026</time><span class="subject body-3">Announcements</span></div>'
              '<span class="title body-3"> Partnering with Accenture on embedded evaluation</span></a></li>'
              '<li><a href="/news/life-sciences-verification-program" class="listItem"><div class="meta">'
              '<time class="date body-3">Sep 17, 2026</time></div>'
              '<span class="title body-3">Introducing the Life Sciences Verification Program</span></a></li>'
              '<li><a href="/news/accenture-embedded-evaluation"><time>Sep 18, 2026</time>'
              '<h4 class="card title">重复项</h4></a></li>'
              '</ul></section>')
        source=dict(id='anthropic',name='Anthropic',url='https://www.anthropic.com/news',official=True,lang='en')
        rows=parse_anthropic_news(html.encode(),source)
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[0]['sourceUrl'],'https://www.anthropic.com/news/accenture-embedded-evaluation')
        self.assertEqual(rows[0]['title'],'Partnering with Accenture on embedded evaluation')
        self.assertEqual(rows[0]['publishedAt'],'2026-09-17T16:00:00Z')
        with self.assertRaises(ValueError): parse_anthropic_news(b'<html>empty</html>',source)

    def test_xai_sitemap_adapter_filters_and_reads_article(self):
        sitemap=('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                 '<url><loc>https://x.ai/news/grok-build-memory</loc><lastmod>2026-09-16T00:00:00.000Z</lastmod></url>'
                 '<url><loc>https://x.ai/news/old-one</loc><lastmod>2026-08-01T00:00:00.000Z</lastmod></url>'
                 '<url><loc>https://x.ai/</loc><lastmod>2026-09-17T00:00:00.000Z</lastmod></url>'
                 '</urlset>')
        article='<html><h1>Memory in Grok Build</h1><script>{"datePublished":"2026-09-16T00:00:00Z"}</script></html>'
        source=dict(id='xai',name='SpaceXAI',url='https://x.ai/sitemap.xml',official=True,lang='en')
        rows=collect_xai(FakeClient(documents={'https://x.ai/news/grok-build-memory':article}),sitemap,source,NOW)
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['title'],'Memory in Grok Build')
        self.assertEqual(rows[0]['publishedAt'],'2026-09-16T00:00:00Z')

    def test_seed_sitemap_adapter_reads_publish_date(self):
        sitemap=('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                 '<url><loc>https://seed.bytedance.com/blog/new-post</loc><lastmod>2026-09-17T03:00:00.000Z</lastmod></url>'
                 '<url><loc>https://seed.bytedance.com/blog/stale-post</loc><lastmod>2026-08-01T03:00:00.000Z</lastmod></url>'
                 '</urlset>')
        article='<html><h1>Seed 新模型正式发布</h1><div><p class="font-medium">发布</p><p class="font-normal">2026-09-16</p></div></html>'
        source=dict(id='seed',name='字节 Seed',url='https://seed.bytedance.com/sitemap.xml',official=True,lang='zh')
        rows=collect_seed(FakeClient(documents={'https://seed.bytedance.com/blog/new-post':article}),sitemap,source,NOW)
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['title'],'Seed 新模型正式发布')
        self.assertEqual(rows[0]['publishedAt'],'2026-09-15T16:00:00Z')

    def test_seed_locale_redirect_keeps_zh_identity(self):
        sitemap=('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                 '<url><loc>https://seed.bytedance.com/blog/new-post</loc><lastmod>2026-09-17T03:00:00.000Z</lastmod></url>'
                 '</urlset>')
        article='<html><h1>Seed 新模型正式发布</h1><div><p class="font-normal">2026-09-16</p></div></html>'
        source=dict(id='seed',name='字节 Seed',url='https://seed.bytedance.com/sitemap.xml',official=True,lang='zh')
        loc='https://seed.bytedance.com/blog/new-post'
        # CI 出口地区跳 /en/blog/：同一篇的其它地区变体照收，身份固定为中文页
        for landing in ('https://seed.bytedance.com/zh/blog/new-post','https://seed.bytedance.com/en/blog/new-post'):
            rows=collect_seed(FakeClient(documents={loc:article},redirects={loc:landing}),sitemap,source,NOW)
            self.assertEqual([r['sourceUrl'] for r in rows],['https://seed.bytedance.com/zh/blog/new-post'])
        # 跳到别的文章仍是结构异常，拒收该条目
        with self.assertRaises(ValueError):
            collect_seed(FakeClient(documents={loc:article},
                                    redirects={loc:'https://seed.bytedance.com/en/blog/other-post'}),sitemap,source,NOW)

    def test_minimax_blog_adapter_reads_article_date(self):
        listing=('<html><a href="/blog/minimax-h3">MiniMax H3</a>'
                 '<a href="/blog/forge-scalable-agent-rl">Forge</a>'
                 '<a href="/blog/_next/asset.js">skip</a></html>')
        article='<html><h1>MiniMax H3：扩展多模态边界</h1><script>{"datePublished":"2026-07-31T03:38:00.000Z"}</script></html>'
        source=dict(id='minimax',name='MiniMax',url='https://www.minimax.cn/blog',official=True,lang='zh')
        documents={'https://www.minimax.cn/blog/minimax-h3':article,
                   'https://www.minimax.cn/blog/forge-scalable-agent-rl':article}
        rows=collect_minimax(FakeClient(documents=documents),listing.encode(),source)
        self.assertEqual([r['sourceUrl'] for r in rows],
                         ['https://www.minimax.cn/blog/minimax-h3','https://www.minimax.cn/blog/forge-scalable-agent-rl'])
        self.assertEqual(rows[0]['publishedAt'],'2026-07-31T03:38:00Z')

    def test_huggingface_models_template_title_and_identity(self):
        raw=json.dumps([
            dict(modelId='zai-org/GLM-5.3-BF16',createdAt='2026-09-18T03:00:00.000Z'),
            dict(modelId='zai-org/GLM-4.7-Flash',createdAt='2026-07-01T00:00:00.000Z')]).encode()
        source=dict(id='hf-zai',name='智谱（Hugging Face）',author='zai-org',titleVendor='智谱',official=True,lang='zh')
        rows=parse_huggingface_models(raw,source)
        self.assertEqual(rows[0]['title'],'智谱发布 GLM-5.3-BF16')
        self.assertEqual(rows[0]['sourceUrl'],'https://huggingface.co/zai-org/GLM-5.3-BF16')
        self.assertEqual(rows[0]['publishedAt'],'2026-09-18T03:00:00Z')
        self.assertEqual(news_event(rows[0]['title'],official=True),'model-release')
        self.assertEqual(news_event('月之暗面发布 Kimi-K3',official=True),'model-release')
        with self.assertRaises(ValueError): parse_huggingface_models(b'{}',source)
        with self.assertRaises(ValueError):
            parse_huggingface_models(json.dumps([dict(modelId='other/repo',createdAt='2026-09-18T03:00:00Z')]).encode(),source)

    def test_zhipu_news_flight_payload_adapter(self):
        items=[dict(id=152,title_zh='智谱首份业绩报告发布，探索AGI智能上界',createAt='2026-03-31T10:00:00.000Z'),
               dict(id=76,title_zh='GLM-PC 基座模型，CogAgent-9B 开源',createAt='2024-12-30T10:44:30.887Z')]
        flight='1:T3,abc7:'+json.dumps({'newsItems':items},ensure_ascii=False)
        chunks=[flight[:40],flight[40:]]
        raw=('<html>'+''.join('<script>self.__next_f.push('+json.dumps([1,c])+')</script>'
                              for c in chunks)+'</html>').encode()
        source=dict(id='zhipu-news',name='智谱官网',url='https://www.zhipuai.cn/zh/news',official=True,lang='zh')
        rows=parse_zhipu_news(raw,source)
        self.assertEqual([r['sourceUrl'] for r in rows],
                         ['https://www.zhipuai.cn/zh/news/152','https://www.zhipuai.cn/zh/news/76'])
        self.assertEqual(rows[0]['publishedAt'],'2026-03-31T10:00:00Z')
        self.assertEqual(rows[1]['publishedAt'],'2024-12-30T10:44:30Z')
        self.assertIsNone(rows[0]['summary'])
        for bad in [b'<html>no payload</html>', b'<html><script>self.__next_f.push([1,"{\\"newsItems\\":[]}"])</script></html>']:
            with self.assertRaises(ValueError): parse_zhipu_news(bad,source)

    def test_tencent_announcement_adapter_filters_third_party(self):
        def row(title,href,date):
            return ('<tr><td><span>\ufeff</span><span><a class="ref" href="'+href+'">'+title+'</a></span></td>'
                    '<td><span>\ufeff '+date+'</span></td></tr>')
        html=('<table>'
              +row('【大模型服务平台 TokenHub】&amp;【智能体开发平台 ADP】 关于腾讯云 HY &amp; YT 系列部分视频生成模型下线及计费调整的通知','https://cloud.tencent.com/announce/detail/2442','2026-08-26')
              +row('关于腾讯云 GLM-5、GLM-5-Turbo、GLM-5.1 模型下线及切换升级的通知','https://cloud.tencent.com/announce/detail/2469','2026-09-08')
              +row('关于腾讯云混元旧版本模型下线的通知','https://cloud.tencent.com/announce/detail/2310','2026-05-22')
              +row('关于腾讯云混元旧版本模型下线的通知','https://cloud.tencent.com/announce/detail/2310','2026-05-22')
              +'</table>')
        source=dict(id='tencent-announce',name='腾讯云 TokenHub',url='https://cloud.tencent.com/document/product/1823/130758',official=True,lang='zh')
        rows=parse_tencent_announcements(html.encode(),source)
        self.assertEqual([r['sourceUrl'] for r in rows],
                         ['https://cloud.tencent.com/announce/detail/2442','https://cloud.tencent.com/announce/detail/2310'])
        # 北京日 00:00 → UTC 前一日 16:00
        self.assertEqual(rows[0]['publishedAt'],'2026-08-25T16:00:00Z')
        self.assertEqual(news_event(rows[0]['title'],official=True),'action-required')
        self.assertNotIn('\ufeff',rows[0]['title'])
        with self.assertRaises(ValueError): parse_tencent_announcements(b'<table></table>',source)

    def test_alibaba_catalog_adapter_filters_to_qwen_and_clips_summary(self):
        def row(kind,date,model,desc):
            return '<tr><td><p>'+kind+'</p></td><td><p>'+date+'</p></td><td><p><code>'+model+'</code></p></td><td><p>'+desc+'</p></td></tr>'
        long=('Qwen-MT-Uni 一次调用即可完成文本、文档、图片、音频的翻译；服务端自动识别输入模态并进行版面还原、语音克隆等处理，'
              '输出翻译后的文本或文件下载链接。支持同步与异步两种调用方式。')
        html=('<table>'+row('类型','时间','模型ID','功能说明')
              +row('多模态翻译','2026-09-16','qwen-mt-uni',long)
              +row('文本生成','2026-07-21','qwen3.7-flash qwen3.7-flash-2026-07-15','别名与快照同行。')
              +row('文本生成','2026-08-31','ZHIPU/GLM-5.3-Flash','第三方托管模型')
              +row('视频生成','2026-08-27','kling/kling-v3','第三方托管模型')
              +'</table>')
        source=dict(id='alibaba-bailian',name='阿里云百炼',url='https://help.aliyun.com/zh/model-studio/newly-released-models',adapter='alibaba-bailian',official=True,lang='zh')
        rows=parse_bailian(html.encode(),source)
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[0]['title'],'阿里发布 qwen-mt-uni')
        self.assertEqual(rows[0]['sourceUrl'],source['url']+'?date=2026-09-16&model=qwen-mt-uni')
        self.assertEqual(normalize_url(rows[0]['sourceUrl']),rows[0]['sourceUrl'])
        self.assertEqual(rows[0]['publishedAt'],'2026-09-15T16:00:00Z')
        self.assertLessEqual(len(rows[0]['summary']),80)
        self.assertEqual(rows[1]['title'],'阿里发布 qwen3.7-flash')
        self.assertEqual(rows[1]['sourceUrl'],source['url']+'?date=2026-07-21&model=qwen3.7-flash')
        data=collect_news(FakeClient(documents={source['url']:html}),[source],{}, {}, NOW,lambda *x:None,lambda *x:None)
        self.assertEqual(len(data['items']),1)
        self.assertEqual(data['items'][0]['eventType'],'major-update')
        batch,_=assemble(None,{'news':data},NOW); validate(batch)
        with self.assertRaises(ValueError): parse_bailian(b'<table></table>',source)

    def test_tokenhub_dynamics_adapter_filters_tencent_models(self):
        def row(desc,date):
            return ('<tr><td><span>动态名称</span></td><td><span>'+desc+'</span></td><td><span>'+date+'</span></td>'
                    '<td><span>模型列表</span></td></tr>')
        html=('<table>'
              +row('新增支持 Hy4 preview 模型。','2026-08-28')
              +row('新增支持 Kimi-K2.6 、YT-VITA 模型。','2026-04-20')
              +row('新增支持 DeepSeek-V4.1-Flash 原厂直供模型。','2026-09-10')
              +row('新增支持 GLM-5.3-Flash 模型。','2026-08-26')
              +'</table>')
        source=dict(id='tencent-tokenhub',name='腾讯云 TokenHub',url='https://cloud.tencent.com/document/product/1823/130675',official=True,lang='zh')
        rows=parse_tokenhub_dynamics(html.encode(),source)
        self.assertEqual([r['title'] for r in rows],
                         ['腾讯云 TokenHub 上线 Hy4 preview 模型','腾讯云 TokenHub 上线 YT-VITA 模型'])
        self.assertEqual(rows[0]['sourceUrl'],source['url']+'?date=2026-08-28&model=hy4-preview')
        self.assertEqual(rows[1]['sourceUrl'],source['url']+'?date=2026-04-20&model=yt-vita')
        self.assertEqual(rows[0]['publishedAt'],'2026-08-27T16:00:00Z')
        with self.assertRaises(ValueError): parse_tokenhub_dynamics(b'<table></table>',source)

    def test_qianfan_model_log_year_sections_and_baidu_filter(self):
        def row(date,vendor,version,action,desc):
            return ('<tr><td>'+date+'</td><td>'+vendor+'</td><td>模型</td><td>'+version+'</td><td>类型</td><td>'+action+'</td>'
                    '<td>'+desc+'</td></tr>')
        html=('<h2><span>2026年9月</span></h2><table>'
              +row('9月15日','百度','ERNIE-5.0-Thinking-Latest','上新','文心新一代思考模型，上下文扩展到 64K，支持更长推理链路。')
              +row('9月15日','杭州深度求索人工智能基础技术研究有限公司','DeepSeek-V4.1-Flash','上新','第三方模型。')
              +'</table><h2>2025年11月</h2><table>'
              +row('11月13日','百度','ERNIE-5.0-Thinking-Preview','升级','预览版升级。')
              +'</table>')
        source=dict(id='baidu-qianfan',name='百度千帆',url='https://cloud.baidu.com/doc/qianfan/s/Kmh4stnjp',official=True,lang='zh')
        rows=parse_qianfan(html.encode(),source)
        self.assertEqual([r['title'] for r in rows],
                         ['百度千帆上线 ERNIE-5.0-Thinking-Latest','百度千帆升级 ERNIE-5.0-Thinking-Preview'])
        self.assertEqual(rows[0]['sourceUrl'],source['url']+'?date=2026-09-15&model=ernie-5-0-thinking-latest')
        self.assertEqual(rows[0]['publishedAt'],'2026-09-14T16:00:00Z')
        self.assertEqual(rows[1]['publishedAt'],'2025-11-12T16:00:00Z')
        with self.assertRaises(ValueError): parse_qianfan(b'<html></html>',source)

    def test_kimi_research_blog_cards_and_template_titles(self):
        def card(href,title,date):
            return ('<div class="menu-card menu-card-hero"><a href="'+href+'" aria-label="'+title+'"></a>'
                    '<div><h4 class="card-title">'+title+'</h4><p class="card-date">'+date+'</p></div></div>')
        html=('<html>'+card('/blog/kimi-k3','Kimi K3','2026-07-16')
              +card('/en/blog/perception-bench','PerceptionBench','2026-07-16')
              +'<div class="menu-card"><span>no link</span></div></html>')
        source=dict(id='kimi-blog',name='月之暗面',url='https://www.kimi.ai/zh-hans/blog/',official=True,lang='zh')
        rows=parse_kimi_blog(html.encode(),source)
        self.assertEqual([r['title'] for r in rows],['月之暗面发布 Kimi K3','月之暗面发布 PerceptionBench'])
        self.assertEqual(rows[0]['sourceUrl'],'https://www.kimi.ai/blog/kimi-k3')
        self.assertEqual(rows[0]['publishedAt'],'2026-07-15T16:00:00Z')
        self.assertEqual(news_event(rows[0]['title'],official=True),'model-release')
        self.assertIsNone(news_event(rows[1]['title'],official=True))
        with self.assertRaises(ValueError): parse_kimi_blog(b'<html></html>',source)

    def test_plans_stale_cache_falls_back_to_pinned_record(self):
        pinned=dict(id='demo-plan',vendor='示例',product='示例套餐',group='domestic',tagline=None,
                    highlights=['甲'],quotaBasis='每月额度',supportedTools=['工具'],
                    tiers=[dict(name='基础',price=10,currency='CNY',period='month',offerType='standard',
                                note=None,features=['功能'],conditions='条件')],
                    models=['模型'],status='available',source='official',
                    sourceUrl='https://vendor.example/plans',updatedAt='2026-09-17',checkMethod='manual',
                    rank=3,rankBasis='示例依据')
        stale={k:v for k,v in pinned.items() if k not in ('rank','rankBasis')}
        broken_config=dict(id='demo',record=pinned,approved=True,sourceUrl='https://vendor.example/plans',
                           scope=dict(tag='section'),adapter='verified-section',evidenceHash='x',evidenceText=['x'])
        page='<section><p>示例证据 甲 乙</p></section>'
        good=dict(pinned,id='ok-plan',sourceUrl='https://vendor.example/ok')
        healthy_config=dict(id='ok',record=good,approved=True,sourceUrl='https://vendor.example/ok',
                            scope=dict(contains=['示例证据']),adapter='verified-section',
                            evidenceHash=digest('示例证据 甲 乙'),evidenceText=['示例证据'])
        reviews=[]
        rows=collect_evidence_records(FakeClient(documents={'https://vendor.example/ok':page}),
                                      [healthy_config,broken_config],[stale],NOW,lambda *x:reviews.append(x))
        # 取页失败时保留旧快照；旧快照缺契约字段则回落到配置里钉住的已核验记录，而不是带崩整批。
        by_id={r['id']:r for r in rows}
        self.assertEqual(set(by_id),{'ok-plan','demo-plan'})
        self.assertEqual(set(by_id['demo-plan']),set(pinned))
        self.assertEqual(by_id['demo-plan']['rank'],3)
        self.assertEqual([x[1] for x in reviews],['demo-plan'])
        ok=collect_evidence_records(FakeClient(documents={'https://vendor.example/ok':page}),
                                    [healthy_config],[pinned],NOW,lambda *x:None)
        by_id={r['id']:r for r in ok}
        self.assertEqual(set(by_id),{'demo-plan','ok-plan'})
        self.assertEqual(by_id['ok-plan']['checkMethod'],'auto')

    def test_clip_summary_boundary(self):
        self.assertEqual(clip('短文本',80),'短文本')
        sentence='第一句话结束了。'*30
        clipped=clip(sentence,80)
        self.assertEqual(len(clipped),80)
        self.assertTrue(clipped.endswith('。'))
        self.assertEqual(len(clip('啊'*100,80)),80)
        self.assertEqual(clip('前言。'*40,80)[-1],'。')

    def test_abstract_never_ends_on_a_bare_separator(self):
        text=('新一代同声传译大模型在翻译质量、延迟、说话人识别和语音合成四个维度全面升级，'
              '字均延迟从上一代的 2.8 秒压缩至 2.3 秒，并新增实时说话人分离能力，同时支持多语种。')
        value=abstract(text,40)
        self.assertLessEqual(len(value),40)
        self.assertFalse(value.endswith(('，','、','；')))
        self.assertEqual(abstract('短简介。'),'短简介。')
        self.assertEqual(abstract('没有标点的长句'*10,10),'没有标点的长句没有标')

    def test_parse_feed_relative_links_and_ernie_titles(self):
        rss=('<rss><channel><item><title>文心 5.1 正式发布！多榜登顶，模型&#34;写得好更懂你&#34;</title>'
             '<link>/blog/zh/posts/ernie-5.1-0508-release/</link>'
             '<pubDate>Sat, 09 May 2026 00:00:00 +0000</pubDate>'
             '<description>文心 5.1 正式上线，仅使用约 6% 的预训练成本。</description></item></channel></rss>')
        source=dict(id='ernie',name='百度文心',url='https://ernie.baidu.com/blog/zh/index.xml',official=True,lang='zh',articleHosts=['ernie.baidu.com'])
        rows=parse_feed(rss,source,lambda *x:None)
        self.assertEqual(rows[0]['sourceUrl'],'https://ernie.baidu.com/blog/zh/posts/ernie-5.1-0508-release/')
        self.assertEqual(rows[0]['publishedAt'],'2026-05-09T00:00:00Z')
        self.assertEqual(news_event(rows[0]['title'],official=True),'model-release')
        # 官方渠道的业绩/财报类不进资讯；讯飞星火可由媒体源覆盖。
        self.assertEqual(news_event('智谱首份业绩报告发布，探索AGI智能上界',official=True),None)
        self.assertEqual(news_event('讯飞星火 X2.5 模型正式发布：293B-A30B MoE'),'model-release')

    def test_transport_decompresses_forced_gzip(self):
        body='<html>forced gzip</html>'.encode()
        self.assertEqual(decompress(gzip.compress(body),'gzip'),body)
        self.assertEqual(decompress(body,''),body)
        self.assertEqual(decompress(body,'identity'),body)
        with self.assertRaises(ValueError): decompress(b'not gzip','gzip')
        with self.assertRaises(ValueError): decompress(gzip.compress(b'x'*8_000_001),'gzip')

    def test_aibase_list_tolerates_single_bad_article(self):
        title='千问APP新增保护功能'
        def article(identity=42):
            row=dict(Id=identity,title=title,addtime='2026-09-17T17:40:15.1505501+08:00')
            flight='1:T3,abc7:'+json.dumps({'article':row},ensure_ascii=False)+'\n'
            return '<h1>'+title+'</h1><script>self.__next_f.push('+json.dumps([1,flight])+')</script>'
        listing='<html><a href="/news/42">a</a><a href="/news/43">b</a></html>'
        source=dict(id='aibase',name='AIBase',url='https://www.aibase.com/zh/news',articleHosts=['www.aibase.com'])
        reviews=[]
        rows=collect_aibase(FakeClient(documents={'https://www.aibase.com/zh/news/42':article(42),
                                                  'https://www.aibase.com/zh/news/43':'<h1>missing</h1>'}),
                            listing.encode(),source,lambda *x:reviews.append(x))
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['sourceUrl'],'https://www.aibase.com/zh/news/42')
        self.assertEqual([r[0] for r in reviews],['news-item'])

    def test_news_similar_title_exclusion(self):
        def feed(entries):
            return '<rss><channel>'+''.join(
                '<item><title>'+title+'</title><link>https://cn.example/'+slug+'</link>'
                '<pubDate>Thu, 17 Sep 2026 09:00:00 +0000</pubDate></item>' for title,slug in entries)+'</channel></rss>'
        source=dict(id='cn',name='中文媒体',url='https://cn.example/feed',articleHosts=['cn.example'])
        def run(entries,old=None):
            return collect_news(FakeClient(documents={source['url']:feed(entries)}),[source],{},old or {},NOW,lambda *x:None,lambda *x:None)
        # 同一事件两篇（共享品牌标记 GLM-5.3-FlashX）只保留一条。
        data=run([('智谱GLM-5.3-FlashX上线：最高 200 tokens/s','a'),
                  ('智谱发布 GLM-5.3-FlashX:速度飙至200tokens/s，国产算力再提速','b')])
        self.assertEqual(len(data['items']),1)
        # 同型号不同事件类型（发布 vs 实测）都保留。
        data=run([('GLM-5.3-FlashX 正式发布','c'),('GLM-5.3-FlashX 实测：速度翻倍','d')])
        self.assertEqual(len(data['items']),2)
        # 归档标题互相包含（无品牌标记）也按同一事件排除。
        data=run([('OpenAI 正式发布全新推理模型','e'),('OpenAI 正式发布全新推理模型，性能提升','f')])
        self.assertEqual(len(data['items']),1)
        # 近 7 天库存中的同事件条目阻止重复入库。
        stock=dict(dataUpdatedAt=NOW,items=[dict(id=digest('https://cn.example/a'),title='智谱GLM-5.3-FlashX上线：最高 200 tokens/s',
                    originalTitle=None,translatedAt=None,summary=None,lang='zh',source='中文媒体',sourceUrl='https://cn.example/a',
                    originalSource='中文媒体',originalUrl='https://cn.example/a',originalVerifiedAt=NOW,url='https://cn.example/a',
                    publishedAt='2026-09-17T09:00:00Z',addedAt=NOW,category='model',eventType='model-release',featured=True)])
        data=run([('智谱发布 GLM-5.3-FlashX:速度飙至200tokens/s，国产算力再提速','b')],stock)
        self.assertEqual(len(data['items']),1)

    def test_news_caps_by_source_and_event_type(self):
        def rss(title, host, index):
            return ('<item><title>' + title + '</title><link>https://' + host + '/' + str(index) +
                    '</link><pubDate>Thu, 17 Sep 2026 09:00:00 +0000</pubDate></item>')
        def feed(rows):
            return '<rss><channel>' + ''.join(rows) + '</channel></rss>'
        source=dict(id='cn',name='中文媒体',url='https://cn.example/feed',articleHosts=['cn.example'])
        # 同一事件类型最多 5 条/天：6 条模型发布只收 5 条。
        data=collect_news(FakeClient(documents={source['url']:feed([rss('示例模型 %d 正式发布'%i,'cn.example',i)
                                                                   for i in range(6)])}),
                          [source],{}, {}, NOW, lambda *x: None, lambda *x: None)
        self.assertEqual(len(data['items']), 5)
        self.assertTrue(all(i['eventType'] == 'model-release' for i in data['items']))
        # 同一来源最多 5 条/天：两类事件共 6 条只收 5 条。
        mixed=[rss('示例模型 %d 正式发布'%i,'cn.example',i) for i in range(3)]
        mixed+=[rss('示例模型 %d 开启免费试用'%i,'cn.example',10+i) for i in range(3)]
        data=collect_news(FakeClient(documents={source['url']:feed(mixed)}),
                          [source],{}, {}, NOW, lambda *x: None, lambda *x: None)
        self.assertEqual(len(data['items']), 5)

    def test_news_featured_selection_model_cache_and_fallback(self):
        def item(identity,published,event):
            url='https://vendor.example/'+identity
            return dict(id=digest(url),title='示例条目 '+identity,originalTitle=None,translatedAt=None,summary=None,lang='zh',
                        source='其他厂商官方',sourceUrl=url,originalSource='其他厂商官方',originalUrl=url,originalVerifiedAt=NOW,url=url,
                        publishedAt=published,addedAt=NOW,category='tool',eventType=event,featured=None)
        events=['model-release','model-release','model-release','model-release','major-update','major-update','major-update']
        rows=[item('%d'%i,'2026-09-17T0%d:00:00Z'%i,events[i]) for i in range(7)]
        day=beijing_day(NOW)
        reply=dict(choices=[dict(message=dict(content=json.dumps({'picks':[3,1]})))])
        client=FakeClient(posts=[reply]); cache={}; reviews=[]
        picks=select_featured(client,rows,cache,'k',{day},NOW,lambda *x:reviews.append(x))
        # 模型名次按回复顺序保留，并写入按候选集签名的缓存。
        self.assertEqual(picks[day],[rows[2]['id'],rows[0]['id']])
        self.assertEqual(len(client.sent),1)
        self.assertEqual(cache[day]['signature'],digest('\n'.join(sorted(i['id'] for i in rows))))
        again=select_featured(FakeClient(),rows,cache,'k',{day},LATER,lambda *x:reviews.append(x))
        self.assertEqual(again[day],picks[day])
        # 无 key 或模型回复不可用时回落固定规则（事件优先级 + 最新发布，最多 10 条），且不写缓存。
        expected=[rows[3]['id'],rows[2]['id'],rows[1]['id'],rows[0]['id'],rows[6]['id'],rows[5]['id'],rows[4]['id']]
        bad=dict(choices=[dict(message=dict(content=json.dumps({'picks':[9]})))])
        too_many=dict(choices=[dict(message=dict(content=json.dumps({'picks':list(range(1,12))})))])
        for client,key,fallback_cache in [(FakeClient(),None,{}),(FakeClient(posts=[bad]),'k',{}),(FakeClient(posts=[too_many]),'k',{})]:
            reviews=[]
            result=select_featured(client,rows,fallback_cache,key,{day},NOW,lambda *x:reviews.append(x))
            self.assertEqual(result[day],expected)
            self.assertEqual(fallback_cache,{})
            if key:
                self.assertEqual([r[0] for r in reviews],['news-featured'])

    def test_collect_news_marks_featured_and_keeps_legacy_picks(self):
        legacy_url='https://vendor.example/legacy'
        legacy=dict(id=digest(legacy_url),title='产品重要更新',originalTitle=None,translatedAt=None,summary=None,lang='zh',
                    source='其他厂商官方',sourceUrl=legacy_url,originalSource='其他厂商官方',originalUrl=legacy_url,
                    originalVerifiedAt=NOW,url=legacy_url,publishedAt='2026-09-16T08:00:00Z',addedAt='2026-09-16T08:00:00Z',
                    category='tool',eventType='major-update',featured=True)
        feed=('<rss><channel>'
              '<item><title>新模型正式发布一</title><link>https://vendor.example/a</link><pubDate>Thu, 17 Sep 2026 10:00:00 +0000</pubDate></item>'
              '<item><title>新模型正式发布二</title><link>https://vendor.example/b</link><pubDate>Thu, 17 Sep 2026 09:00:00 +0000</pubDate></item>'
              '</channel></rss>')
        source=dict(id='vendor',name='示例厂商官方',url='https://vendor.example/feed',official=True,lang='zh',articleHosts=['vendor.example'])
        seen=[]
        def feature(items,days):
            seen.append(sorted(days))
            return {beijing_day(NOW):[digest('https://vendor.example/a')]}
        data=collect_news(FakeClient(documents={source['url']:feed}),[source],{},dict(dataUpdatedAt=NOW,items=[legacy]),NOW,
                          lambda *x:None,lambda *x:None,feature=feature)
        by_url={i['sourceUrl']:i for i in data['items']}
        # 只重判本轮有新增的入库日；入选为 true、未入选为 null，历史精选不被清掉。
        self.assertEqual(seen,[[beijing_day(NOW)]])
        self.assertIs(by_url['https://vendor.example/a']['featured'],True)
        self.assertIsNone(by_url['https://vendor.example/b']['featured'])
        self.assertIs(by_url[legacy_url]['featured'],True)

    def test_news_featured_editorial_exclusion_overrides_picks(self):
        feed=('<rss><channel>'
              '<item><title>新模型正式发布一</title><link>https://vendor.example/a</link><pubDate>Thu, 17 Sep 2026 10:00:00 +0000</pubDate></item>'
              '</channel></rss>')
        source=dict(id='vendor',name='示例厂商官方',url='https://vendor.example/feed',official=True,lang='zh',articleHosts=['vendor.example'])
        identity=digest('https://vendor.example/a')
        # 排除项按规范化 sourceUrl 计算 id：utm_* 等跟踪参数不影响命中。
        self.assertEqual(news_featured_exclusions(['https://vendor.example/a?utm_source=x']),{identity})
        data=collect_news(FakeClient(documents={source['url']:feed}),[source],{}, {}, NOW, lambda *x:None, lambda *x:None,
                          feature=lambda items,days:{beijing_day(NOW):[identity]}, exclude={identity})
        self.assertEqual(len(data['items']),1)
        self.assertIsNone(data['items'][0]['featured'])

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
        for blurb in ('A coding-agent skill for security audits','Open Multi-Agent Interactive Classroom',
                      'High-Quality Voice Cloning TTS for 600+ Languages','The open-source AI voice studio',
                      'TimesFM is a pretrained time-series foundation model','A cloud-native vector database for ANN search',
                      'Fault-tolerant GPU orchestration and a machine learning framework','Voice-to-text dictation app'):
            self.assertTrue(is_ai(dict(row,description=blurb),{}),blurb)
        for blurb in ('12 weeks, 26 lessons, classic Machine Learning for all','Neural Networks: Zero to Hero',
                      'A series of Jupyter notebooks about Deep Learning','A Python handbook for beginners'):
            self.assertFalse(is_ai(dict(row,description=blurb),{}),blurb)
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
        data=collect_github(FakeClient(documents=documents),NOW,['python'],{},{},lambda *x:None,lambda *x:None)
        self.assertEqual([i['repo'] for i in data['week']['items']],['vendor/fast','vendor/slow'])
        self.assertEqual(data['week']['items'][0]['sourceRank'],1)
        self.assertEqual(data['week']['items'][1]['sourceRank'],2)
        self.assertNotIn('vendor/ad',[i['repo'] for i in data['week']['items']])
        self.assertEqual(data['week']['sourceUrl'],base)
        self.assertEqual(data['month']['sourceUrl'],month)
        self.assertEqual(len(data['week']['items']),2)

    def test_github_zh_blurb_replaces_covered_repo_only(self):
        def card(repo,period,desc):
            return ('<article class="Box-row"><h2><a href="/'+repo+'">'+repo+'</a></h2><p>'+desc+'</p>'
                    '<a href="/'+repo+'/stargazers">9,000</a><span>'+str(period)+' stars this week</span></article>')
        base='https://github.com/trending?since=weekly'; month='https://github.com/trending?since=monthly'
        documents={base:'<html>'+card('vendor/tool',900,'LLM coding agent')+card('vendor/other',800,'LLM coding agent')+'</html>',
                   month:'<html>'+card('vendor/tool',900,'LLM coding agent')+'</html>'}
        data=collect_github(FakeClient(documents=documents),NOW,[],{},{'vendor/tool':'人工中文简介'},lambda *x:None,lambda *x:None)
        by_repo={i['repo']:i for i in data['week']['items']}
        self.assertEqual(by_repo['vendor/tool']['description'],'人工中文简介')
        self.assertEqual(by_repo['vendor/other']['description'],'LLM coding agent')

    def test_github_machine_translation_cache_and_manual_priority(self):
        def card(repo,period,desc):
            return ('<article class="Box-row"><h2><a href="/'+repo+'">'+repo+'</a></h2><p>'+desc+'</p>'
                    '<a href="/'+repo+'/stargazers">9,000</a><span>'+str(period)+' stars this week</span></article>')
        base='https://github.com/trending?since=weekly'; month='https://github.com/trending?since=monthly'
        documents={base:'<html>'+card('vendor/tool',900,'LLM coding agent')+card('vendor/other',800,'LLM coding agent')+'</html>',
                   month:'<html>'+card('vendor/tool',900,'LLM coding agent')+'</html>'}
        reply=dict(choices=[dict(message=dict(content=json.dumps({'vendor/other':'机器翻译草稿'},ensure_ascii=False)))])
        client=FakeClient(documents=documents,posts=[reply]); cache={}; reviews=[]
        translate=lambda items: translate_github(client,items,cache,'test-key',NOW,lambda *x:reviews.append(x))
        data=collect_github(client,NOW,[],{},{'vendor/tool':'人工中文简介'},lambda *x:None,lambda *x:reviews.append(x),translate)
        by_repo={i['repo']:i for i in data['week']['items']}
        self.assertEqual(by_repo['vendor/tool']['description'],'人工中文简介')
        self.assertEqual(by_repo['vendor/other']['description'],'机器翻译草稿')
        self.assertEqual(cache['vendor/other']['source'],'deepseek-flash')
        self.assertEqual(set(json.loads(client.sent[0][1]['messages'][1]['content'])),{'vendor/other'})
        # 第二次运行命中缓存，不再调用接口。
        client.posts=[]
        data=collect_github(client,NOW,[],{},{'vendor/tool':'人工中文简介'},lambda *x:None,lambda *x:None,lambda items: translate_github(client,items,cache,'test-key',NOW,lambda *x:None))
        self.assertEqual(client.posts,[])
        self.assertEqual(len(reviews),0)
        # 无 key 时保留英文原文，不阻塞发布。
        data=collect_github(FakeClient(documents=documents),NOW,[],{},{},lambda *x:None,lambda *x:None)
        self.assertEqual({i['repo']:i['description'] for i in data['week']['items']},
                         {'vendor/tool':'LLM coding agent','vendor/other':'LLM coding agent'})

    def test_translation_failure_keeps_source_text_and_reviews_once(self):
        def card(repo,period,desc):
            return ('<article class="Box-row"><h2><a href="/'+repo+'">'+repo+'</a></h2><p>'+desc+'</p>'
                    '<a href="/'+repo+'/stargazers">9,000</a><span>'+str(period)+' stars this week</span></article>')
        base='https://github.com/trending?since=weekly'; month='https://github.com/trending?since=monthly'
        documents={base:'<html>'+card('vendor/tool',900,'LLM coding agent')+'</html>',month:'<html>'+card('vendor/tool',900,'LLM coding agent')+'</html>'}
        reviews=[]; cache={}
        translate=lambda items: translate_github(FakeClient(documents=documents,posts=[DataError('HTTP 401')]),items,cache,'bad-key',NOW,lambda *x:reviews.append(x))
        data=collect_github(FakeClient(documents=documents),NOW,[],{},{},lambda *x:None,lambda *x:None,translate)
        self.assertEqual(data['week']['items'][0]['description'],'LLM coding agent')
        self.assertEqual([r[0] for r in reviews],['github-translate'])
        # 译文非中文按失败处理，缓存不写入。
        bad=dict(choices=[dict(message=dict(content=json.dumps({'vendor/tool':'same text'})))])
        reviews=[]; cache={}
        translate_github(FakeClient(posts=[bad]),[dict(repo='vendor/tool',description='LLM agent')],cache,'k',NOW,lambda *x:reviews.append(x))
        self.assertEqual(cache,{}); self.assertEqual(len(reviews),1)
        # 缺项只收下有效译文，缺的条目下轮重试。
        partial=dict(choices=[dict(message=dict(content=json.dumps({'vendor/one':'有效译文'})))])
        reviews=[]; cache={}
        result=translate_github(FakeClient(posts=[partial]),
                                [dict(repo='vendor/one',description='LLM agent'),dict(repo='vendor/two',description='LLM agent')],
                                cache,'k',NOW,lambda *x:reviews.append(x))
        self.assertEqual(result,{'vendor/one':'有效译文'})
        self.assertEqual(set(cache),{'vendor/one'}); self.assertEqual(reviews,[])

    def test_translate_prunes_cache_and_skips_chinese_descriptions(self):
        client=FakeClient(posts=[dict(choices=[dict(message=dict(content=json.dumps({'vendor/tool':'新译文'})))])])
        cache={'vendor/gone':dict(text='旧译文',source='deepseek-chat',at=NOW),'vendor/cn':dict(text='已有译文',source='deepseek-chat',at=NOW)}
        reviews=[]
        result=translate_github(client,[dict(repo='vendor/tool',description='LLM agent'),
                                        dict(repo='vendor/cn',description='中文原文')],cache,'k',NOW,lambda *x:reviews.append(x))
        self.assertEqual(result,{'vendor/cn':'已有译文','vendor/tool':'新译文'})
        self.assertEqual(set(cache),{'vendor/cn','vendor/tool'})
        sent=json.loads(client.sent[0][1]['messages'][1]['content'])
        self.assertEqual(set(sent),{'vendor/tool'})

    def test_load_key_reads_named_dotenv_entries_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            env=Path(tmp)/'.env'
            env.write_text('AA_key = "aa-secret"\nDEEPSEEK_API_KEY=ds-secret # note\nOTHER=ignored\n',encoding='utf-8')
            self.assertEqual(load_key(env,('DEEPSEEK_API_KEY','DEEPSEEK_KEY'),'DEEPSEEK_API_KEY'),'ds-secret')
            with self.assertRaises(ValueError): load_key(env,('MISSING_KEY',),'MISSING_KEY')

    def test_github_page_failure_is_isolated(self):
        base='https://github.com/trending?since=weekly'; lang='https://github.com/trending/python?since=weekly'
        month='https://github.com/trending?since=monthly'; month_lang='https://github.com/trending/python?since=monthly'
        card='<article class="Box-row"><h2><a href="/vendor/tool">vendor/tool</a></h2><p>LLM agent</p><a href="/vendor/tool/stargazers">9</a><span>5 stars this week</span></article>'
        reviews=[]
        documents={base:'<html>'+card+'</html>',lang:DataError('HTTP 503'),
                   month:'<html>'+card+'</html>',month_lang:DataError('HTTP 503')}
        data=collect_github(FakeClient(documents=documents),NOW,['python'],{},{},lambda *x:None,lambda *x:reviews.append(x))
        self.assertEqual([i['repo'] for i in data['week']['items']],['vendor/tool'])
        self.assertEqual([r[0] for r in reviews],['github-page','github-page'])

    def test_github_all_pages_failed(self):
        base='https://github.com/trending?since=weekly'; lang='https://github.com/trending/python?since=weekly'
        documents={base:DataError('HTTP 503'),lang:DataError('HTTP 503')}
        with self.assertRaises(ValueError):
            collect_github(FakeClient(documents=documents),NOW,['python'],{},{},lambda *x:None,lambda *x:None)

    def test_github_ambiguous_below_cutoff_is_not_queued(self):
        def card(repo,period,desc):
            return ('<article class="Box-row"><h2><a href="/'+repo+'">'+repo+'</a></h2><p>'+desc+'</p>'
                    '<a href="/'+repo+'/stargazers">9,000</a><span>'+str(period)+' stars this week</span></article>')
        confirmed=''.join(card('vendor/tool'+str(i),100-i,'LLM coding agent') for i in range(32))
        near=card('vendor/near',80,'A small utility for teams')
        far=card('vendor/far',50,'A small utility for teams')
        base='https://github.com/trending?since=weekly'; month='https://github.com/trending?since=monthly'
        documents={base:'<html>'+confirmed+near+far+'</html>',month:'<html>'+confirmed+'</html>'}
        reviews=[]
        data=collect_github(FakeClient(documents=documents),NOW,[],{},{},lambda *x:None,lambda *x:reviews.append(x))
        queued=[r[1] for r in reviews]
        self.assertIn('vendor/near',queued)
        self.assertNotIn('vendor/far',queued)
        self.assertEqual(len(data['week']['items']),30)
        self.assertEqual(data['week']['items'][0]['periodStars'],100)
        self.assertEqual(data['week']['items'][-1]['periodStars'],71)

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
        data=collect_news(FakeClient(documents={source['url']:'<rss><channel>'+items+'</channel></rss>'}),[source],{}, {},NOW,lambda *x:None,lambda *x:reviews.append(x))
        self.assertEqual(len(data['items']),3)
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
        data=collect_news(FakeClient(documents=documents),[source],mapping, {},NOW,lambda *x:None,lambda *x:None)
        self.assertEqual(data['items'][0]['url'],official)
        documents[official]='<h1>Homepage</h1>'
        data=collect_news(FakeClient(documents=documents),[source],mapping, {},NOW,lambda *x:None,lambda *x:None)
        self.assertEqual(data['items'][0]['url'],article)

    def test_news_tracking_parameters_stripped_from_source_url(self):
        item='<item><title>新模型正式发布</title><link>https://cn.example/story?utm_source=rss&amp;utm_medium=feed&amp;p=7</link><pubDate>Thu, 17 Sep 2026 09:00:00 +0000</pubDate></item>'
        source=dict(id='cn',name='中文媒体',url='https://cn.example/feed',articleHosts=['cn.example'])
        data=collect_news(FakeClient(documents={source['url']:'<rss><channel>'+item+'</channel></rss>'}),[source],{}, {},NOW,lambda *x:None,lambda *x:None)
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
        record=dict(id='plan',vendor='Vendor',product='Coding',group='overseas',tagline=None,highlights=[],quotaBasis=None,supportedTools=['CLI'],models=[],status='available',source='official',sourceUrl='https://vendor.example/plan',updatedAt='2026-09-16',checkMethod='auto',rank=None,rankBasis=None,tiers=[dict(name='Pro',price=10,currency='USD',period='month',offerType='standard',note=None,features=['100 credits'],conditions='Individual subscription')])
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
            write_json(editorial/'overrides.json',dict(github={},news=dict(featuredExclude=[]),records=[]))
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
            write_json(editorial/'overrides.json',dict(github={},news=dict(featuredExclude=[]),records=[]))
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
