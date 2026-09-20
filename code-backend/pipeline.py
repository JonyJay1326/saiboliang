"""Collect into a validated candidate batch; never deploy or commit implicitly."""
import argparse
import copy
import json
import os
import re
import shutil
import subprocess
import sys
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from common import Client, DataError, digest, load_aa_key, load_key, read_json, require, utcnow, write_json
from contract import TICKET, empty_batch, obj, validate
from sources import collect_aa, collect_evidence_records, collect_github, collect_news, model_data, summarize_news, translate_github, translate_news

ROOT=Path(__file__).resolve().parent
MODULES=('tickets','models','github','news')


def body(data):
    return {k:v for k,v in data.items() if k not in ('version','generatedAt')}


def read_batch(directory):
    files=[directory/(name+'.json') for name in ('version',*MODULES)]
    if not any(p.exists() for p in files):
        return None
    require(all(p.exists() for p in files),'incomplete saved batch; restore it before collecting')
    batch={p.stem:read_json(p) for p in files}
    validate(batch)
    return batch


def assemble(old,updates,now):
    batch=copy.deepcopy(old or empty_batch(now))
    for name,data in updates.items():
        batch[name]=body(data)
    changed=old is None or any(body(batch[k])!=body(old[k]) for k in MODULES)
    if not changed:
        return copy.deepcopy(old),False
    version=now
    if old and version<=old['version']['version']:
        version=(datetime.fromisoformat(old['version']['version'])+timedelta(seconds=1)).strftime('%Y-%m-%dT%H:%M:%SZ')
    batch['version']=dict(version=version,generatedAt=version)
    for name in MODULES:
        batch[name].update(version=version,generatedAt=version)
    validate(batch,old)
    return batch,True


@contextmanager
def lock(path):
    path.parent.mkdir(parents=True,exist_ok=True)
    try:
        fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
    except FileExistsError:
        raise DataError('another collection is running; inspect state/collect.lock if a previous process crashed') from None
    try:
        with os.fdopen(fd,'w') as stream:
            stream.write(str(os.getpid()))
        yield
    finally:
        path.unlink()


def save_candidate(directory,batch):
    directory.mkdir(parents=True,exist_ok=True)
    for name,data in batch.items():
        write_json(directory/(name+'.json'),data)
    validate(read_batch(directory))


def promote(candidate,output):
    """Local disk transaction. Public serving starts only after a later build/deploy.

    A leftover backup is recovered before the next promotion. A running server
    must never point directly at this candidate/output directory.
    """
    batch=read_batch(candidate); require(batch is not None,'candidate missing')
    require(candidate.resolve()!=output.resolve() and candidate.resolve() not in output.resolve().parents and output.resolve() not in candidate.resolve().parents,'candidate and output must be separate directories')
    if output.exists():
        require({p.name for p in output.iterdir()}=={n+'.json' for n in ('version',*MODULES)},'output contains unrelated files; refusing directory replacement')
    backup=output.with_name(output.name+'.previous')
    if backup.exists():
        require(not output.exists(),'previous promotion backup remains; inspect before retrying')
        backup.rename(output)
    staged=output.with_name(output.name+'.next')
    require(not staged.exists(),'staged output remains; inspect before retrying')
    save_candidate(staged,batch)
    try:
        if output.exists():
            output.rename(backup)
        staged.rename(output)
    except OSError:
        if backup.exists() and not output.exists():
            backup.rename(output)
        raise
    # Only these five known files, no recursive directory deletion.
    if backup.exists():
        for name in ('version',*MODULES):
            (backup/(name+'.json')).unlink()
        backup.rmdir()


REVIEW_OWNER={'github-page':'github','github-classification':'github','github-translate':'github',
              'models':'models','model-mapping':'models','model-price':'models','plans':'models',
              'news-item':'news','news-original':'news','news-future':'news','news-translate':'news',
              'news-summary':'news','news-source':'news'}


class Run:
    def __init__(self,state,now):
        self.state,self.now=state,now
        self.health=read_json(state/'source-health.json',{})
        self.queue=read_json(state/'review-queue.json',[])
        require(isinstance(self.health,dict) and isinstance(self.queue,list),'invalid internal state')
        self.keys={i['id'] for i in self.queue}
        self.fresh=set()
        self.counts={}
        self.success=[]; self.errors={}; self.skipped=[]; self.retired=0

    def review(self,kind,identity,reason,evidence):
        value=dict(kind=kind,objectId=identity,reason=reason,evidence=evidence)
        key=digest(json.dumps(value,sort_keys=True,ensure_ascii=False))
        self.fresh.add(key)
        if key not in self.keys:
            self.queue.append(dict(value,id=key,status='pending',createdAt=self.now))
            self.keys.add(key)

    def guard(self,source,count):
        previous=self.health.get(source,{}).get('count')
        require(previous is None or count>=previous*0.6,'candidate count dropped below 60%: '+source)
        self.counts[source]=count

    def retire(self):
        """The queue holds what currently needs review, not an append-only log.

        Only a module that succeeded this run may retire entries, so a partial run
        (or a failed module that keeps its old public data) never drops its items.
        """
        succeeded=set(self.success)
        kept=[]
        for item in self.queue:
            if item['id'] in self.fresh:
                kept.append(item); continue
            owner=item['objectId'] if item['kind']=='source' else REVIEW_OWNER.get(item['kind'])
            if owner in succeeded:
                continue
            kept.append(item)
        self.retired=len(self.queue)-len(kept)
        self.queue=kept

    def save(self):
        self.retire()
        write_json(self.state/'source-health.json',self.health)
        write_json(self.state/'review-queue.json',self.queue)
        write_json(self.state/'run.json',dict(at=self.now,success=self.success,errors=self.errors,skipped=self.skipped,retired=self.retired))


def load_config(editorial):
    sources=read_json(editorial/'sources.json')
    require(isinstance(sources,dict) and set(sources)=={'github','news','plans'},'invalid source configuration')
    for section in sources.values():
        require(isinstance(section,list),'source list required')
    require(sources['github'] and all(isinstance(s,str) and re.fullmatch(r'[a-z0-9+#.-]+',s) for s in sources['github']),'invalid github language pages')
    require(len(set(sources['github']))==len(sources['github']),'duplicate github language page')
    overrides=read_json(editorial/'overrides.json')
    require(isinstance(overrides,dict) and set(overrides)=={'github','records'},'invalid overrides')
    require(isinstance(overrides['github'],dict) and isinstance(overrides['records'],list),'invalid override records')
    zh=read_json(editorial/'github-zh.json',{})
    require(isinstance(zh,dict),'invalid github zh map')
    for repo,blurb in zh.items():
        require(isinstance(repo,str) and re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',repo),'invalid github zh repo')
        require(isinstance(blurb,str) and blurb.strip() and '\n' not in blurb,'invalid github zh blurb')
    return sources,overrides,zh


def load_tickets(editorial,old,now):
    """Manually curated ticket file; the pipeline only stamps and validates it."""
    records=read_json(editorial/'tickets.json')
    require(isinstance(records,list),'ticket file must be an array')
    for record in records:
        obj(record,TICKET)
    require(len({r['id'] for r in records})==len(records),'duplicate ticket identity')
    unchanged=records==old.get('tickets')
    return dict(dataUpdatedAt=old.get('dataUpdatedAt') if unchanged else now,tickets=records)


def apply_overrides(data,module,overrides,review,now):
    if module!='models':
        return data
    index={p['id']:p for p in data['plans']}
    for entry in overrides['records']:
        require(set(entry)=={'module','record','reason','evidenceUrl','at'},'override fields mismatch')
        require(entry['module']=='plans','unsupported override module')
        from common import safe_url
        from contract import stamp
        safe_url(entry['evidenceUrl']); stamp(entry['at'])
        require(entry['reason'] and entry['at']<=now,'override audit evidence required')
        record=copy.deepcopy(entry['record'])
        require(record['checkMethod']=='manual','manual override must retain manual evidence')
        index[record['id']]=record
    data['plans']=sorted(index.values(),key=lambda p:p['id'])
    return data


def load_translator(args,client,run,now):
    """Machine drafts for repos without a manual blurb; cache is internal state only."""
    cache=read_json(args.state/'github-zh-cache.json',{})
    require(isinstance(cache,dict),'invalid github zh cache')
    try:
        key=load_key(args.env_file,('DEEPSEEK_API_KEY','DEEPSEEK_KEY','DeepSeek_key'),'DEEPSEEK_API_KEY')
    except DataError:
        run.skipped.append('github-translate: no DEEPSEEK_API_KEY; uncovered repos keep source text')
        return None
    def translate(items):
        result=translate_github(client,items,cache,key,now,run.review)
        write_json(args.state/'github-zh-cache.json',cache)
        return result
    return translate


def load_news_translator(args,client,run,now):
    """Machine translations for English official news; cache is internal state only."""
    cache=read_json(args.state/'news-zh-cache.json',{})
    require(isinstance(cache,dict),'invalid news zh cache')
    try:
        key=load_key(args.env_file,('DEEPSEEK_API_KEY','DEEPSEEK_KEY','DeepSeek_key'),'DEEPSEEK_API_KEY')
    except DataError:
        run.skipped.append('news-translate: no DEEPSEEK_API_KEY; English items are skipped')
        return None
    def translate(items):
        result=translate_news(client,items,cache,key,now,run.review)
        write_json(args.state/'news-zh-cache.json',cache)
        return result
    return translate


def load_news_summarizer(args,client,run,now):
    """Model-drafted Chinese abstracts for items whose source provides none."""
    cache=read_json(args.state/'news-summary-cache.json',{})
    require(isinstance(cache,dict),'invalid news summary cache')
    try:
        key=load_key(args.env_file,('DEEPSEEK_API_KEY','DEEPSEEK_KEY','DeepSeek_key'),'DEEPSEEK_API_KEY')
    except DataError:
        run.skipped.append('news-summary: no DEEPSEEK_API_KEY; items keep empty summaries')
        return None
    def summarize(items):
        result=summarize_news(client,items,cache,key,now,run.review)
        write_json(args.state/'news-summary-cache.json',cache)
        return result
    return summarize


def collect(args):
    state=args.state; now=utcnow(); run=Run(state,now)
    sources,overrides,github_zh=load_config(args.editorial)
    originals=read_json(args.editorial/'news-originals.json',{})
    require(isinstance(originals,dict),'invalid news originals')
    old=read_batch(args.output); baseline=old or empty_batch(now)
    raw_cache=read_json(state/'source-cache.json',{k:body(baseline[k]) for k in MODULES})
    require(isinstance(raw_cache,dict) and set(raw_cache)==set(MODULES),'invalid source cache')
    config_hash=digest(json.dumps(sources,sort_keys=True,ensure_ascii=False))
    client=Client(); updates={}; translator=None
    for module in args.modules:
        daily=module=='models'
        last=run.health.get(module,{}).get('lastSuccess')
        if daily and not args.force and last and last[:10]==now[:10] and run.health[module].get('configHash')==config_hash:
            # Still recompute explicit manual overrides without refreshing source times.
            updates[module]=apply_overrides(copy.deepcopy(raw_cache[module]),module,overrides,run.review,now)
            run.skipped.append(module+': daily sources already checked')
            continue
        run.counts={}
        try:
            if module=='github':
                translator=translator or load_translator(args,client,run,now)
                data=collect_github(client,now,sources['github'],overrides['github'],github_zh,run.guard,run.review,translator)
            elif module=='models':
                version,rows=collect_aa(client,load_aa_key(args.env_file))
                run.guard('aa',len(rows))
                data=model_data(version,rows,raw_cache['models'],now,run.review)
                plans=[s for s in sources['plans'] if s['enabled']]
                data['plans']=collect_evidence_records(client,plans,data['plans'],now,run.review)
            elif module=='news':
                news=[s for s in sources['news'] if s['enabled']]
                require(news,'no admitted official news source')
                news_translator=load_news_translator(args,client,run,now)
                news_summarizer=load_news_summarizer(args,client,run,now)
                data=collect_news(client,news,originals,baseline['news'],now,run.guard,run.review,news_translator,
                                  summarize=news_summarizer,window_seconds=args.backfill_days*24*3600 or 72*3600,
                                  backfill=args.backfill_days>0)
            else:
                data=load_tickets(args.editorial,raw_cache['tickets'],now)
            raw_candidate=copy.deepcopy(data)
            data=apply_overrides(data,module,overrides,run.review,now)
            # Validate each candidate before accepting its freshness and count baseline.
            assemble(baseline,{module:data},now)
            updates[module]=data; run.success.append(module)
            raw_cache[module]=raw_candidate
            run.health[module]=dict(lastSuccess=now,lastAttempt=now,error=None,configHash=config_hash)
            for source,count in run.counts.items():
                run.health[source]=dict(lastSuccess=now,count=count)
            print(module+': OK',flush=True)
        except (ValueError,KeyError,TypeError,UnicodeError) as exc:
            message=str(exc)
            run.errors[module]=message
            run.health[module]=dict(run.health.get(module,{}),lastAttempt=now,error=message)
            run.review('source',module,message,{})
            print(module+': FAILED - '+message,flush=True)
            manual=apply_overrides(copy.deepcopy(raw_cache[module]),module,overrides,run.review,now)
            if manual!=body(baseline[module]):
                assemble(baseline,{module:manual},now)
                updates[module]=manual
    if not run.success and not updates:
        run.save()
        return 1
    batch,changed=assemble(old,updates,now)
    save_candidate(args.candidate,batch)
    if args.build_command:
        command=list(args.build_command)
        # Windows: CreateProcess 不解析 .cmd/.bat，裸 'npm' 会 WinError 2。
        # shutil.which 遵循 PATHEXT，在类 Unix 上等价于原生 PATH 查找。
        resolved=shutil.which(command[0])
        if resolved:
            command[0]=resolved
        result=subprocess.run(command,cwd=args.build_cwd,check=False,env={**os.environ,'DATA_CANDIDATE_DIR':str(args.candidate.resolve())})
        if result.returncode:
            run.errors['build']='build command failed; public data unchanged'
            # Do not advance successful daily source clocks before accepted publication.
            previous=read_json(state/'source-health.json',{})
            run.health=previous
            run.save()
            return 1
    if changed:
        promote(args.candidate,args.output)
    write_json(state/'source-cache.json',raw_cache)
    audit=[entry for entry in overrides['records']]
    audit_path=state/'audit.jsonl'
    existing=audit_path.read_text(encoding='utf-8').splitlines() if audit_path.exists() else []
    known=set(existing)
    for entry in audit:
        line=json.dumps(entry,ensure_ascii=False,sort_keys=True)
        if line not in known:
            existing.append(line); known.add(line)
    audit_path.parent.mkdir(parents=True,exist_ok=True)
    tmp=audit_path.with_suffix('.jsonl.tmp'); tmp.write_text('\n'.join(existing)+ ('\n' if existing else ''),encoding='utf-8'); os.replace(tmp,audit_path)
    run.save()
    print('batch '+batch['version']['version']+(': updated' if changed else ': unchanged'),flush=True)
    return 2 if run.errors else 0


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=('init','collect','validate'))
    parser.add_argument('--output',type=Path,default=ROOT/'public'/'data')
    parser.add_argument('--candidate',type=Path,default=ROOT/'.cache'/'candidate')
    parser.add_argument('--state',type=Path,default=ROOT/'state')
    parser.add_argument('--editorial',type=Path,default=ROOT/'editorial')
    parser.add_argument('--env-file',type=Path,default=ROOT.parent/'.env')
    parser.add_argument('--modules',nargs='+',choices=MODULES,default=list(MODULES))
    parser.add_argument('--force',action='store_true',help='repeat daily source checks explicitly')
    parser.add_argument('--backfill-days',type=int,default=0,
                        help='one-off news backfill: widen admission to N days and stamp addedAt with publishedAt')
    parser.add_argument('--build-cwd',type=Path,default=ROOT.parent)
    parser.add_argument('--build-command',nargs=argparse.REMAINDER)
    args=parser.parse_args(argv)
    try:
        if args.command=='validate':
            require(read_batch(args.output) is not None,'no public batch')
            print('five-file contract: PASS')
            return 0
        with lock(args.state/'collect.lock'):
            if args.command=='init':
                require(read_batch(args.output) is None,'public batch already exists')
                save_candidate(args.candidate,empty_batch(utcnow()))
                promote(args.candidate,args.output)
                print('initialized empty unverified batch')
                return 0
            return collect(args)
    except (ValueError,OSError) as exc:
        # Network errors are sanitized in Client; never print raw request headers.
        print('ERROR: '+str(exc),file=sys.stderr)
        return 1


if __name__=='__main__':
    sys.exit(main())
