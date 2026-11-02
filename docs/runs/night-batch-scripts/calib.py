import sqlite3, shutil, json, os, sys
S='/tmp/claude-0/-home-user/688ec361-72ad-554b-b31d-67a034944a81/scratchpad'
W=S+'/wt-night'
pairs={3:'dry-142',6:'dry-143',28:'dry-144'}
def q(db, sql, *a):
    try: return db.execute(sql, a).fetchall()
    except Exception as e: return [('ERR', str(e)[:80])]
for seed, dry in pairs.items():
    src=f'{W}/data/{dry}.sqlite'; dst=f'{S}/night/calib/{dry}.sqlite'
    for ext in ['','-wal','-shm']:
        if os.path.exists(src+ext): shutil.copy(src+ext, dst+ext)
    db=sqlite3.connect(f'file:{dst}?mode=ro', uri=True)
    sim=json.load(open(f'{W}/docs/runs/variation/2026-11-02/sim-{seed}.json'))
    print(f'== seed {seed}: sim vs live ({dry})')
    print(' sim refusals over cap:', sim['outcomes']['purchases'], '| policies', sim['outcomes']['policies'])
    print(' live refusal reasons:', q(db, "SELECT substr(refusal_reason,1,40), COUNT(*) FROM upstream_purchases WHERE outcome='REFUSED' GROUP BY 1"))
    print(' live on-chain refusal records:', q(db, "SELECT event, COUNT(*) FROM audit_log WHERE event IN ('upstream.refused_on_chain','upstream.refusal_not_recorded') GROUP BY 1"))
    print(' live policies:', [ (lambda p: f"{p['supplier']}{' <='+p['max_price'] if p.get('max_price') else ''}{' cache '+str(p['cache_seconds'])+'s' if p.get('cache_seconds') else ''}")(json.loads(r[0])) for r in q(db, "SELECT payload_json FROM audit_log WHERE event='sourcing.policy_set' ORDER BY seq")])
    print(' sim proposals:', [p['kind'] for p in sim['outcomes']['proposals']], '| live:', q(db, "SELECT kind, status FROM proposals ORDER BY created_at"))
    print(' sim refunded:', sim['outcomes']['refunded'], '| live refunds:', q(db, "SELECT COUNT(*), COALESCE(SUM(amount_cents),0) FROM refunds WHERE outcome IN ('PAID','PENDING','HELD')"))
    print(' sim receipt:', (sim['outcomes']['receipt'] or '')[:80], '| live receipts:', q(db, "SELECT outcome, substr(detail,1,60) FROM receipts"))
    print(' sim card:', sim['outcomes']['card'], '| live card events:', q(db, "SELECT substr(payload_json,1,160) FROM world_events WHERE kind='card.declined' LIMIT 1"))
    print(' live transfers:', q(db, "SELECT invoice_no, amount, currency, method, fee_estimate, status FROM transfers"))
    print(' live fees:', q(db, "SELECT event, substr(payload_json,1,140) FROM audit_log WHERE event LIKE '%fee%' OR event LIKE 'fx.%' OR event LIKE '%quote%' LIMIT 4"))
