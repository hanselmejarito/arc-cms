const order = ['Medical supplies','Anti-rabies vaccine','Tetanus Toxoid','ERIG (serum)']
export function philhealthServices(lines, fallback = '') {
 const names = (lines.length ? lines.map(line=>line.service) : String(fallback).split(', ')).map(name=>String(name||'').replace(/\s*×\s*\d+$/,'').trim()).filter(Boolean)
 return [...new Set(names)].sort((a,b)=>{const x=order.indexOf(a),y=order.indexOf(b);return (x<0?order.length:x)-(y<0?order.length:y)}).join(', ')
}
