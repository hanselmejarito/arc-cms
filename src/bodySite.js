const points={Head:{L:[138,31],R:[114,31]},'Upper extremity':{L:[174,120],R:[78,120]},Hand:{L:[183,186],R:[64,186]},Torso:{L:[138,110],R:[112,110]},'Lower extremity':{L:[144,246],R:[108,246]},Foot:{L:[147,318],R:[100,318]}}
// The back diagram reverses horizontal orientation from the front diagram.
export function bodySitePoint(site,side,view){const point=points[site]?.[side];if(!point||!['Front','Back'].includes(view))return null;return view==='Back'?[472-point[0],point[1]]:point}
