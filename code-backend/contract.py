"""Frozen public contract: closed objects, references and derived values."""
import re
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from common import digest, finite, normalize_url, require, safe_url

ID = r'[a-z0-9]+(?:-[a-z0-9]+)*'


def text(v):
    require(isinstance(v, str) and bool(v.strip()), 'expected nonempty text')


def stamp(v):
    require(isinstance(v, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', v), 'invalid UTC timestamp')
    datetime.strptime(v, '%Y-%m-%dT%H:%M:%SZ')


def day(v):
    require(isinstance(v, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', v), 'invalid date')
    date.fromisoformat(v)


def identifier(v):
    require(isinstance(v, str) and re.fullmatch(ID, v), 'invalid ID')


def integer(v):
    require(type(v) is int and v >= 0, 'invalid nonnegative integer')


def positive(v):
    integer(v)
    require(v > 0, 'expected positive integer')


def number(v):
    require(finite(v, 0), 'invalid price')


def boolean(v):
    require(type(v) is bool, 'invalid boolean')


def enum(*values):
    return lambda v: require(v in values, 'invalid enum')


def nullable(check):
    return lambda v: check(v) if v is not None else None


def array(check):
    def validate(v):
        require(isinstance(v, list), 'expected array')
        for item in v:
            check(item)
    return validate


def obj(value, fields):
    require(isinstance(value, dict) and set(value) == set(fields), 'object fields mismatch: ' + ','.join(fields))
    for key, check in fields.items():
        try:
            check(value[key])
        except (ValueError, TypeError) as exc:
            raise ValueError(key + ': ' + str(exc)) from exc


def unique(items, key=None):
    values = [item[key] if key else item for item in items]
    require(len(values) == len(set(values)), 'duplicate identity')


def summary(v):
    text(v)
    require(len(v) <= 80, 'summary exceeds 80 code points')


def score_value(v):
    require(type(v) is int and 0 <= v <= 100, 'invalid ticket score')


def beijing_stamp(v):
    require(isinstance(v, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00', v), 'invalid Beijing timestamp')
    datetime.fromisoformat(v)


def content_text(v):
    text(v)
    require(len(v) <= 2000, 'content exceeds 2000 code points')


TICKET = dict(id=identifier, title=text, vendor=text, category=enum('api-quota','token','credits'),
              score=score_value,
              tags=lambda v: obj(v, dict(duration=enum('limited','longterm','unknown'), region=enum('cn','global','overseas-only','unknown'))),
              expired=boolean, expiryDate=nullable(beijing_stamp), summary=summary, content=content_text,
              link=safe_url, affiliate=boolean, publishedAt=day, updatedAt=day)
MODEL = dict(id=identifier, name=text, vendor=text, aaId=nullable(text), releasedAt=nullable(day),
             inputCost=nullable(number), outputCost=nullable(number), priceSource=nullable(enum('artificial-analysis')),
             priceSourceUrl=nullable(safe_url), priceUpdatedAt=nullable(stamp))
TIER = dict(name=text, price=nullable(number), currency=enum('CNY','USD'), period=enum('month','year'),
            offerType=enum('standard','promotion','new-user'), note=nullable(text), features=array(text), conditions=text)
PLAN = dict(id=identifier, vendor=text, product=text, group=enum('domestic','overseas'), tagline=nullable(text),
            highlights=array(text), quotaBasis=nullable(text), supportedTools=array(text), tiers=array(lambda v: obj(v,TIER)),
            models=array(text), status=enum('available','unavailable','unknown'), source=enum('official','aggregator'),
            sourceUrl=safe_url, updatedAt=day, checkMethod=enum('auto','manual'),
            rank=nullable(positive), rankBasis=nullable(text))
RANKING = dict(modelId=identifier, score=lambda v: require(finite(v), 'invalid score'), rank=positive)
REPO = dict(repo=lambda v: require(isinstance(v,str) and re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',v), 'invalid repo'),
            sourceRank=positive, stars=integer, periodStars=nullable(integer), language=nullable(text), description=nullable(text), url=safe_url)
EVENTS = ['action-required','model-release','major-update','price-or-free','upcoming','model-review','hands-on','deep-analysis']
CATEGORY_BY_EVENT = dict({'model-release':'model','model-review':'model','major-update':'tool','hands-on':'tool'},
                         **{e:'industry' for e in ('action-required','price-or-free','upcoming','deep-analysis')})
NEWS = dict(id=lambda v: require(isinstance(v,str) and re.fullmatch(r'[a-f0-9]{64}',v), 'invalid news ID'), title=text,
            originalTitle=nullable(text), translatedAt=nullable(stamp), summary=nullable(summary), lang=enum('zh','en'),
            source=text, sourceUrl=safe_url, originalSource=nullable(text), originalUrl=nullable(safe_url), originalVerifiedAt=nullable(stamp),
            url=safe_url, publishedAt=stamp, addedAt=stamp, category=enum('model','tool','industry'), eventType=enum(*EVENTS))


def news_order(item):
    return -datetime.fromisoformat(item['publishedAt']).timestamp(), item['id']


def empty_batch(version):
    base = dict(version=version, generatedAt=version, dataUpdatedAt=None)
    return {
        'version': dict(version=version, generatedAt=version),
        'tickets': dict(base, tickets=[]),
        'models': dict(base, rankings=dict(source='artificial-analysis', sourceUrl='https://artificialanalysis.ai/', indexVersion=None, updatedAt=None, intelligence=[], coding=[]), models=[], plans=[]),
        'github': dict(base, source='github-trending', **{k:dict(period=p, sourceUrl='https://github.com/trending?since='+p, fetchedAt=None, items=[]) for k,p in [('week','weekly'),('month','monthly')]}),
        'news': dict(base, items=[]),
    }


def validate(batch, previous=None):
    require(set(batch) == {'version','tickets','models','github','news'}, 'five files required')
    base = dict(version=stamp, generatedAt=stamp)
    business = dict(base, dataUpdatedAt=nullable(stamp))
    obj(batch['version'], base)
    obj(batch['tickets'], dict(business, tickets=array(lambda v: obj(v,TICKET))))
    obj(batch['models'], dict(business, rankings=lambda v: obj(v,dict(source=enum('artificial-analysis'),sourceUrl=safe_url,indexVersion=nullable(text),updatedAt=nullable(stamp),intelligence=array(lambda r:obj(r,RANKING)),coding=array(lambda r:obj(r,RANKING)))), models=array(lambda v:obj(v,MODEL)), plans=array(lambda v:obj(v,PLAN))))
    window = dict(period=enum('weekly','monthly'),sourceUrl=safe_url,fetchedAt=nullable(stamp),items=array(lambda v:obj(v,REPO)))
    obj(batch['github'], dict(business,source=enum('github-trending'),week=lambda v:obj(v,window),month=lambda v:obj(v,window)))
    obj(batch['news'],dict(business,items=array(lambda v:obj(v,NEWS))))
    version = batch['version']['version']
    for module in batch.values():
        require(module['version'] == module['generatedAt'] == version, 'mixed batch')
        require(module.get('dataUpdatedAt') is None or module['dataUpdatedAt'] <= version, 'future freshness')
    tickets = batch['tickets']
    unique(tickets['tickets'],'id')
    shanghai_day = (datetime.fromisoformat(version) + timedelta(hours=8)).date().isoformat()
    for t in tickets['tickets']:
        require(t['publishedAt'] <= t['updatedAt'] <= shanghai_day, 'ticket dates')
        require((t['expiryDate'] is not None) == (t['tags']['duration'] == 'limited'), 'ticket duration/expiry mismatch')
    models = batch['models']; unique(models['models'],'id'); unique(models['plans'],'id')
    index = {m['id']:m for m in models['models']}
    r = models['rankings']
    require((r['indexVersion'] is None)==(r['updatedAt'] is None), 'index evidence missing')
    require(r['updatedAt'] is None or r['updatedAt'] <= version,'future index timestamp')
    for key in ('intelligence','coding'):
        rows = r[key]; unique(rows,'modelId')
        require(len(rows)<=30 and [v['rank'] for v in rows]==list(range(1,len(rows)+1)), 'ranking size/order')
        require(rows==sorted(rows,key=lambda v:(-v['score'],v['modelId'])), 'score order')
        require(not rows or r['updatedAt'] is not None, 'unverified rankings')
        require(all(v['modelId'] in index and index[v['modelId']]['aaId'] for v in rows),'ranking references')
    for m in index.values():
        priced = m['inputCost'] is not None or m['outputCost'] is not None
        require(all((m[k] is not None)==priced for k in ('priceSource','priceSourceUrl','priceUpdatedAt')), 'price evidence mismatch')
        require(m['priceUpdatedAt'] is None or m['priceUpdatedAt']<=version,'future price evidence')
    for p in models['plans']:
        unique(p['models']); unique(p['tiers'],'name')
        require(p['supportedTools'] and p['tiers'],'plan empty tools/tiers')
        for t in p['tiers']:
            require(t['features'],'empty tier features')
        require(p['updatedAt']<=shanghai_day,'future plan date')
        require((p['rank'] is None)==(p['rankBasis'] is None),'plan rank/basis pairing')
    for group in ('domestic','overseas'):
        ranks=[p['rank'] for p in models['plans'] if p['group']==group and p['rank'] is not None]
        require(len(ranks)==len(set(ranks)),'duplicate plan rank')
    for key,period in [('week','weekly'),('month','monthly')]:
        w=batch['github'][key]; unique(w['items'],'repo')
        require(w['period']==period and w['sourceUrl']=='https://github.com/trending?since='+period,'wrong trending period')
        require(w['items']==sorted(w['items'],key=lambda i:(i['periodStars'] is None,-(i['periodStars'] or 0),i['repo'])),'trending period order')
        require(not any(i['repo'].startswith('sponsors/') for i in w['items']),'sponsor slot in trending')
        require(w['fetchedAt'] is None or w['fetchedAt']<=version,'future trending evidence')
        require(not w['items'] or w['fetchedAt'] is not None,'unverified trending')
        require(all(i['url']=='https://github.com/'+i['repo'] for i in w['items']),'repo URL mismatch')
    items=batch['news']['items']; unique(items,'id')
    require(items==sorted(items,key=news_order),'news order')
    collected=batch['news']['dataUpdatedAt']
    require(collected is not None or not items,'news without collection time')
    for i in items:
        require(re.search(r'[\u3400-\u9fff]',i['title']), 'Chinese title required')
        require(i['id']==digest(normalize_url(i['sourceUrl'])),'news identity')
        require(i['url']==(i['originalUrl'] or i['sourceUrl']),'news destination')
        require((i['originalUrl'] is None)==(i['originalSource'] is None)==(i['originalVerifiedAt'] is None),'original evidence pairing')
        require((i['originalTitle'] is None)==(i['translatedAt'] is None),'translation evidence pairing')
        require((i['lang']=='en')==(i['originalTitle'] is not None),'language/translation mismatch')
        require(i['originalVerifiedAt'] is None or i['originalVerifiedAt']<=version,'future original verification')
        require(i['translatedAt'] is None or i['translatedAt']<=version,'future translation')
        require(i['addedAt']<=version,'future addition')
        require(collected is None or i['addedAt']<=collected,'addition after collection')
        age=(datetime.fromisoformat(i['addedAt'])-datetime.fromisoformat(i['publishedAt'])).total_seconds()
        require(-300<=age<=72*3600,'news outside admission window')
    daily={}
    for i in items:
        key=(datetime.fromisoformat(i['addedAt'])+timedelta(hours=8)).date().isoformat()
        daily.setdefault(key,[]).append(i)
    for rows in daily.values():
        require(len(rows)<=6,'news daily limit')
        require(all(n<=2 for n in Counter(i['source'] for i in rows).values()),'news daily source limit')
        require(all(n<=2 for n in Counter(i['eventType'] for i in rows).values()),'news daily event-type limit')
