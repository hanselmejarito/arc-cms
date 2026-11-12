from pathlib import Path
p = Path('src/screens/Clinical.jsx')
s = p.read_text(encoding='utf8')
for old, new in [
    ('admissions=encounters.filter(x=>x.patientId===p.id);return', 'admissions=encounters.filter(x=>x.patientId===p.id&&inB(branch,encBranch(x)));return'),
    ('last:[e?.date,...other.map(t=>t.date)].filter(Boolean).sort().at(-1)', 'last:[...admissions.map(x=>x.date),...other.map(t=>t.date)].filter(Boolean).sort().at(-1)'),
    ('rows={encs} empty="No visits recorded."', 'rows={encs} empty="No admissions recorded."')
]:
    assert s.count(old) == 1, old
    s = s.replace(old, new, 1)
p.write_text(s, encoding='utf8')
