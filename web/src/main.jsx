import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { computeMetrics } from './geo.js';

const places = [
  { location:'Whitefield', latitude:12.9698, longitude:77.75 },
  { location:'Hebbal', latitude:13.0358, longitude:77.597 },
  { location:'Sarjapur', latitude:12.9081, longitude:77.695 },
  { location:'Electronic City', latitude:12.8399, longitude:77.677 },
  { location:'Devanahalli', latitude:13.247, longitude:77.713 }
];
const metricGroups = [
 {title:'Connectivity', metrics:[
  ['nearest_airport_km','Nearest airport'], ['nearest_metro_station_km','Nearest metro station'],
  ['nearest_rail_station_km','Nearest railway station'], ['nearest_highway_km','Nearest highway']]},
 {title:'Amenities & land', metrics:[
  ['schools_within_1km','Schools & colleges · 1 km'], ['schools_within_3km','Schools & colleges · 3 km'],
  ['healthcare_within_1km','Healthcare · 1 km'],['healthcare_within_5km','Healthcare · 5 km'],
  ['parks_within_1km','Parks & gardens · 1 km'],['parks_within_3km','Parks & gardens · 3 km'],
  ['retail_within_2km','Retail · 2 km'], ['nearest_mapped_water_km','Nearest mapped water'],
  ['road_density_within_1km','Road density · 1 km'],['building_footprint_coverage_within_1km','Building coverage · 1 km']]}
];
const layers = [
 {id:'metro_stations',label:'Metro stations',color:'#e25dff',radius:5},
 {id:'rail_stations',label:'Rail stations',color:'#ff9a3c',radius:5},
 {id:'airports',label:'Airports',color:'#ffffff'},
 {id:'highways',label:'Highways',color:'#ffd84d',width:2.2},
 {id:'schools',label:'Education',color:'#f5bb58'}, {id:'healthcare',label:'Healthcare',color:'#ff7e88'},
 {id:'parks',label:'Parks',color:'#66c8a7'}, {id:'water',label:'Water',color:'#5db6ec'},
 {id:'retail',label:'Retail',color:'#c59dff'}, {id:'roads',label:'Roads',color:'#8796ae'},
 {id:'buildings',label:'Buildings',color:'#c4d0dd'}
];
const empty = {type:'FeatureCollection',features:[]};
const LAZY = ['roads','buildings']; // large; fetched only when toggled on
const DEFAULT_AOI = [77.35,12.75,77.85,13.25]; // demo bbox, not an official boundary
const EDGE_KM = 5;
const inAoi = ([lon,lat],a) => lon>=a[0]&&lon<=a[2]&&lat>=a[1]&&lat<=a[3];
const nearEdge = ([lon,lat],a) => Math.min((lon-a[0])*108.6,(a[2]-lon)*108.6,(lat-a[1])*110.6,(a[3]-lat)*110.6) < EDGE_KM;
const parseLatLon = (q) => { const m=q.trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/); if(!m) return null;
 let a=+m[1], b=+m[2]; if(a>60&&b<60) [a,b]=[b,a]; return [b,a]; }; // returns [lon,lat]; accepts "lat, lon" or "lon, lat" for Bengaluru
const readUrl = () => { const u=new URLSearchParams(location.search); const lat=parseFloat(u.get('lat')), lon=parseFloat(u.get('lon'));
 if(Number.isFinite(lat)&&Number.isFinite(lon)) return {custom:{lon,lat,label:u.get('label')||''}};
 const p=u.get('place'); return {place: places.some(x=>x.location===p)?p:'Whitefield'}; };
const writeUrl = (sel,custom) => { const u=new URLSearchParams();
 if(sel==='custom'&&custom){u.set('lat',custom.lat.toFixed(5));u.set('lon',custom.lon.toFixed(5));if(custom.label)u.set('label',custom.label);} else u.set('place',sel);
 history.replaceState(null,'',`${location.pathname}?${u}`); };
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const PLAIN_STYLE = {version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#101c2b'}}]};
const fetchJSON = async (path) => {const res=await fetch(path,{cache:'no-store'});if(!res.ok) throw new Error(`HTTP ${res.status}`);return res.json()};
const metricDisplay = (key,m) => {
 if(m?.status==='loading') return 'Computing…';
 if(m?.status==='pilot_only') return 'Pilot areas only';
 if(!m || m.status!=='calculated' || m.value===null || m.value===undefined) return 'No data';
 if(key.endsWith('_km')) return `${Number(m.value).toFixed(m.value<10?2:1)} km`;
 if(key==='road_density_within_1km') return `${m.value} km/km²`;
 if(key==='building_footprint_coverage_within_1km') return `${m.value}%`;
 return String(m.value);
};
function App(){
 const mapEl=useRef(null), mapRef=useRef(null);
 const init=useRef(readUrl()).current;
 const [selected,setSelected]=useState(init.custom?'custom':init.place),[custom,setCustom]=useState(init.custom||null);
 const [metrics,setMetrics]=useState(null),[status,setStatus]=useState(null);
 const [available,setAvailable]=useState({}),[enabled,setEnabled]=useState(['metro_stations','rail_stations','airports','highways','schools','healthcare']);
 const [mapError,setMapError]=useState(''),[loaded,setLoaded]=useState(false),[basemap,setBasemap]=useState(true);
 const [query,setQuery]=useState(''),[results,setResults]=useState(null),[searching,setSearching]=useState(false),[searchMsg,setSearchMsg]=useState('');
 const requested=useRef(new Set());
 const aoi=metrics?.aoi_bbox_wsen||DEFAULT_AOI;
 const isCustom=selected==='custom'&&custom;
 const point=isCustom?{location:custom.label||'Selected point',latitude:custom.lat,longitude:custom.lon}:places.find(p=>p.location===selected);
 const customMetrics=useMemo(()=>isCustom?computeMetrics([custom.lon,custom.lat],available):null,[isCustom,custom,available]);
 const result=isCustom?{metrics:customMetrics}:metrics?.locations?.find(p=>p.location===selected);
 const loadLayer=(id)=>{if(requested.current.has(id))return;requested.current.add(id);
  fetchJSON(`/data/${id}.geojson`).then(geo=>setAvailable(old=>({...old,[id]:geo}))).catch(()=>{/* layer not published */});};
 useEffect(()=>{
  Promise.allSettled([fetchJSON('/data/demo_location_metrics.json'),fetchJSON('/data/data_status.json')]).then(([m,s])=>{
   if(m.status==='fulfilled')setMetrics(m.value);
   if(s.status==='fulfilled')setStatus(s.value);
  });
  layers.filter(l=>!LAZY.includes(l.id)).forEach(l=>loadLayer(l.id));
 },[]);
 useEffect(()=>{enabled.filter(id=>LAZY.includes(id)).forEach(loadLayer)},[enabled]);
 useEffect(()=>{writeUrl(selected,custom)},[selected,custom]);
 const pick=(lon,lat,label='')=>{
  if(!inAoi([lon,lat],aoi)){setSearchMsg('That point is outside the covered Bengaluru area.');return;}
  setSearchMsg('');setCustom({lon,lat,label});setSelected('custom');setResults(null);
 };
 const pickRef=useRef(pick);pickRef.current=pick;
 const search=async(e)=>{e.preventDefault();const q=query.trim();if(!q)return;
  const ll=parseLatLon(q);if(ll){pick(ll[0],ll[1]);return;}
  setSearching(true);setSearchMsg('');setResults(null);
  try{const [w,s,e2,n]=aoi;
   const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=in&bounded=1&viewbox=${w},${n},${e2},${s}&q=${encodeURIComponent(q)}`;
   const res=await fetchJSON(url);
   if(!res.length)setSearchMsg('No match inside the covered area. Try a locality name, or click the map.');
   setResults(res.map(r=>({lon:+r.lon,lat:+r.lat,name:r.display_name})));
  }catch{setSearchMsg('Search is unavailable right now. You can click the map or enter "lat, lon".');}
  finally{setSearching(false);}
 };
 useEffect(()=>{
  if(!mapEl.current)return;
  // Free, keyless OpenFreeMap vector basemap (OpenMapTiles schema). If it cannot
  // load, fall back to a plain background so the data layers still render.
  let map, styleReady=false, fellBack=false;
  try{map=new maplibregl.Map({container:mapEl.current,style:BASEMAP_STYLE,center:[77.64,12.98],zoom:10.3,attributionControl:false});}
  catch(err){setMapError(`Map unavailable: ${err?.message||'WebGL not supported'}`);return;}
  map.once('styledata',()=>{styleReady=true});
  map.on('error',e=>{
   if(!styleReady&&!fellBack){fellBack=true;setBasemap(false);map.setStyle(PLAIN_STYLE);return;}
   if(e.sourceId||e.tile)return; // a single missing tile is not worth alarming the user
   setMapError(e.error?.message||'Map rendering error');
  });
  mapRef.current=map;
  map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
  map.on('load',()=>{setLoaded(true);
   map.addSource('places',{type:'geojson',data:{type:'FeatureCollection',features:places.map(p=>({type:'Feature',geometry:{type:'Point',coordinates:[p.longitude,p.latitude]},properties:{location:p.location}}))}});
   map.addSource('custom',{type:'geojson',data:empty});
   map.addLayer({id:'place-halos',type:'circle',source:'places',paint:{'circle-radius':12,'circle-color':'#6fe1c1','circle-opacity':0.12}});
   map.addLayer({id:'place-points',type:'circle',source:'places',paint:{'circle-radius':6,'circle-color':'#70e1c1','circle-stroke-color':'#0d1724','circle-stroke-width':2}});
   map.addLayer({id:'custom-halo',type:'circle',source:'custom',paint:{'circle-radius':16,'circle-color':'#ffffff','circle-opacity':0.15}});
   map.addLayer({id:'custom-point',type:'circle',source:'custom',paint:{'circle-radius':7,'circle-color':'#ffffff','circle-stroke-color':'#ff5d8f','circle-stroke-width':3}});
   map.on('click',e=>{
    const hit=map.queryRenderedFeatures(e.point,{layers:['place-points']});
    if(hit.length){setSelected(hit[0].properties.location);return;}
    pickRef.current(e.lngLat.lng,e.lngLat.lat);
   });
   map.on('mouseenter','place-points',()=>map.getCanvas().style.cursor='pointer');
   map.on('mouseleave','place-points',()=>map.getCanvas().style.cursor='crosshair');
   map.getCanvas().style.cursor='crosshair';
  });
  return()=>{map.remove();mapRef.current=null};
 },[]);
 useEffect(()=>{const map=mapRef.current;if(map&&loaded&&point)map.flyTo({center:[point.longitude,point.latitude],zoom:Math.max(map.getZoom(),12),essential:true,duration:800})},[selected,custom,loaded]);
 useEffect(()=>{const map=mapRef.current;if(!map||!loaded)return;
  map.getSource('custom')?.setData(isCustom?{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[custom.lon,custom.lat]},properties:{}}]}:empty);
 },[custom,selected,loaded]);
 useEffect(()=>{const map=mapRef.current;if(!map||!loaded)return;
  for(const l of layers){const sourceId=`osm-${l.id}`;const layerId=`visual-${l.id}`;
   const geo=available[l.id]||empty;
   if(!map.getSource(sourceId))map.addSource(sourceId,{type:'geojson',data:geo});else map.getSource(sourceId).setData(geo);
   const kinds=[
    ['fill',['Polygon','MultiPolygon'],{'fill-color':l.color,'fill-opacity':0.24}],
    ['outline',['Polygon','MultiPolygon'],{'line-color':l.color,'line-width':1.2,'line-opacity':0.8}],
    ['line',['LineString','MultiLineString'],{'line-color':l.color,'line-width':l.width||1.1,'line-opacity':0.75}],
    ['circle',['Point','MultiPoint'],{'circle-color':l.color,'circle-radius':l.radius||4,'circle-stroke-color':'#101c2b','circle-stroke-width':1}]];
   for(const [kind,types,paint] of kinds){const id=`${layerId}-${kind}`;
    if(!map.getLayer(id))map.addLayer({id,type:kind==='outline'?'line':kind,source:sourceId,filter:['match',['geometry-type'],types,true,false],paint},'place-halos');
    map.setLayoutProperty(id,'visibility',enabled.includes(l.id)?'visible':'none');}
  }
 },[available,enabled,loaded]);
 const hasData=!!metrics?.locations?.length;
 const edge=isCustom&&nearEdge([custom.lon,custom.lat],aoi);
 return <div className="app"><header><div className="brand"><div className="brand-mark">G<span>●</span></div><div><strong>GeoIntel</strong><small>BENGALURU EXPLORER</small></div></div><div className="header-right"><span className="pill">PUBLIC DATA · EXPERIMENTAL</span><span className="version">MVP 0.5</span></div></header>
 <div className="workspace"><aside className="sidebar"><div className="eyebrow">LOCATION INTELLIGENCE</div><h1>Explore Bengaluru<br/><em>through data.</em></h1><p className="intro">Search an address or locality, enter coordinates, or click anywhere on the map to see connectivity and amenities around it. Hover an indicator to see how it is calculated.</p>
 <form className="search" onSubmit={search}><label htmlFor="q">FIND A LOCATION</label><div className="search-row"><input id="q" value={query} onChange={e=>setQuery(e.target.value)} placeholder="e.g. Indiranagar, or 12.9716, 77.5946" autoComplete="off"/><button type="submit" disabled={searching}>{searching?'…':'Search'}</button></div>
 {results?.length>0&&<ul className="results">{results.map((r,i)=><li key={i}><button type="button" onClick={()=>pick(r.lon,r.lat,r.name.split(',').slice(0,2).join(','))}>{r.name}</button></li>)}</ul>}
 {searchMsg&&<p className="search-msg">{searchMsg}</p>}</form>
 <label htmlFor="place">OR A PILOT LOCATION</label><select id="place" value={selected} onChange={e=>setSelected(e.target.value)}>{isCustom&&<option value="custom">Selected point</option>}{places.map(p=><option key={p.location}>{p.location}</option>)}</select>
 {metricGroups.map(g=><React.Fragment key={g.title}><div className="section-head"><h2>{g.title}</h2><span>{isCustom?'Computed in browser':hasData?'OSM-derived':'Awaiting data'}</span></div>
 <div className="metrics">{g.metrics.map(([key,label])=>{const m=result?.metrics?.[key];return <div className="metric" key={key} title={m?.method||''}><span>{label}{m?.nearest_feature&&<small className="via">{m.nearest_feature}</small>}</span><strong className={m?.status==='calculated'?'':'muted'}>{metricDisplay(key,m)}</strong></div>})}</div></React.Fragment>)}
 {edge&&<p className="notice warn">This point is within {EDGE_KM} km of the edge of the covered area, so counts and nearest features may be incomplete.</p>}
 <p className="notice">{hasData?'Indicators describe mapped features, not verified real-world inventories. Distances are straight-line, not travel time.':'No live metrics have been published. Run the local data pipeline and export outputs to populate this dashboard.'}</p>
 </aside><main className="map-area"><div className="map" ref={mapEl}></div><div className="map-top"><div><strong>{point?.location}</strong><span>{point?.latitude.toFixed(4)}° N · {point?.longitude.toFixed(4)}° E</span></div></div>
 <div className="layer-panel"><div className="layer-title">MAP LAYERS <span>{Object.values(available).filter(g=>g.features?.length).length} loaded · click map to pick a point</span></div>{layers.map(l=><label className="layer" key={l.id}><input type="checkbox" checked={enabled.includes(l.id)} onChange={e=>setEnabled(old=>e.target.checked?[...old,l.id]:old.filter(v=>v!==l.id))}/><span className="swatch" style={{background:l.color}}/>{l.label}<span className="layer-count">{available[l.id]?.features?.length??(LAZY.includes(l.id)?'off':'—')}</span></label>)}</div>
 <div className="map-bottom">{mapError?<span className="error">{mapError}</span>:<span>{basemap?<>Basemap <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a></>:'Basemap unavailable · showing data layers only'} · Search <a href="https://nominatim.org" target="_blank" rel="noreferrer">Nominatim</a></span>}<span>Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · ODbL</span></div></main></div>
 <footer><span>GeoIntel is a research prototype. Not for title, zoning, flood, or legal decisions.</span><span>{status?.generated_at_utc?`Data status generated ${new Date(status.generated_at_utc).toLocaleDateString()}`:'No published acquisition timestamp'}</span></footer></div>;
}
createRoot(document.getElementById('root')).render(<App/>);
