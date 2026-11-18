import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

const places = [
  { location:'Whitefield', latitude:12.9698, longitude:77.75 },
  { location:'Hebbal', latitude:13.0358, longitude:77.597 },
  { location:'Sarjapur', latitude:12.9081, longitude:77.695 },
  { location:'Electronic City', latitude:12.8399, longitude:77.677 },
  { location:'Devanahalli', latitude:13.247, longitude:77.713 }
];
const metricLabels = [
 ['schools_within_1km','Schools & colleges · 1 km'], ['schools_within_3km','Schools & colleges · 3 km'],
 ['healthcare_within_1km','Healthcare · 1 km'],['healthcare_within_5km','Healthcare · 5 km'],
 ['parks_within_1km','Parks & gardens · 1 km'],['parks_within_3km','Parks & gardens · 3 km'],
 ['retail_within_2km','Retail · 2 km'], ['nearest_mapped_water_km','Nearest mapped water'],
 ['road_density_within_1km','Road density · 1 km'],['building_footprint_coverage_within_1km','Building coverage · 1 km']
];
const layers = [
 {id:'schools',label:'Education',color:'#f5bb58'}, {id:'healthcare',label:'Healthcare',color:'#ff7e88'},
 {id:'parks',label:'Parks',color:'#66c8a7'}, {id:'water',label:'Water',color:'#5db6ec'},
 {id:'retail',label:'Retail',color:'#c59dff'}, {id:'roads',label:'Roads',color:'#8796ae'},
 {id:'buildings',label:'Buildings',color:'#c4d0dd'}
];
const empty = {type:'FeatureCollection',features:[]};
const fetchJSON = async (path) => {const res=await fetch(path,{cache:'no-store'});if(!res.ok) throw new Error(`HTTP ${res.status}`);return res.json()};
const metricDisplay = (key,m) => {
 if(!m || m.status!=='calculated' || m.value===null || m.value===undefined) return 'No data';
 if(key==='nearest_mapped_water_km') return `${m.value} km`;
 if(key==='road_density_within_1km') return `${m.value} km/km²`;
 if(key==='building_footprint_coverage_within_1km') return `${m.value}%`;
 return String(m.value);
};
function App(){
 const mapEl=useRef(null), mapRef=useRef(null);
 const [selected,setSelected]=useState('Whitefield'),[metrics,setMetrics]=useState(null),[status,setStatus]=useState(null);
 const [available,setAvailable]=useState({}),[enabled,setEnabled]=useState(['schools','healthcare','parks','water']);
 const [mapError,setMapError]=useState(''),[loaded,setLoaded]=useState(false);
 const selectedPlace=places.find(p=>p.location===selected);
 const result=metrics?.locations?.find(p=>p.location===selected);
 useEffect(()=>{
  let cancelled=false;
  Promise.allSettled([fetchJSON('/data/demo_location_metrics.json'),fetchJSON('/data/data_status.json')]).then(([m,s])=>{
   if(cancelled)return;
   if(m.status==='fulfilled')setMetrics(m.value);
   if(s.status==='fulfilled')setStatus(s.value);
  });
  layers.forEach(async l=>{try{const geo=await fetchJSON(`/data/${l.id}.geojson`);if(!cancelled)setAvailable(old=>({...old,[l.id]:geo}));}catch{/* layer not published */}});
  return()=>{cancelled=true};
 },[]);
 useEffect(()=>{
  if(!mapEl.current)return;
  // No public OSM raster tile endpoint: map renders only locally published GeoJSON.
  const map=new maplibregl.Map({container:mapEl.current,style:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#101c2b'}}]},center:[77.64,12.98],zoom:10.3,attributionControl:false});
  mapRef.current=map;
  map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
  map.on('load',()=>{setLoaded(true);
   map.addSource('places',{type:'geojson',data:{type:'FeatureCollection',features:places.map(p=>({type:'Feature',geometry:{type:'Point',coordinates:[p.longitude,p.latitude]},properties:{location:p.location}}))}});
   map.addLayer({id:'place-halos',type:'circle',source:'places',paint:{'circle-radius':12,'circle-color':'#6fe1c1','circle-opacity':0.12}});
   map.addLayer({id:'place-points',type:'circle',source:'places',paint:{'circle-radius':6,'circle-color':'#70e1c1','circle-stroke-color':'#0d1724','circle-stroke-width':2}});
   map.on('click','place-points',e=>setSelected(e.features[0].properties.location));
   map.on('mouseenter','place-points',()=>map.getCanvas().style.cursor='pointer');
   map.on('mouseleave','place-points',()=>map.getCanvas().style.cursor='');
  });
  map.on('error',e=>setMapError(e.error?.message||'Map rendering error'));
  return()=>{map.remove();mapRef.current=null};
 },[]);
 useEffect(()=>{const map=mapRef.current;if(map&&loaded)map.flyTo({center:[selectedPlace.longitude,selectedPlace.latitude],zoom:12,essential:true,duration:800})},[selected,loaded]);
 useEffect(()=>{const map=mapRef.current;if(!map||!loaded)return;
  for(const l of layers){const sourceId=`osm-${l.id}`;const layerId=`visual-${l.id}`;
   const geo=available[l.id]||empty;
   if(!map.getSource(sourceId))map.addSource(sourceId,{type:'geojson',data:geo});else map.getSource(sourceId).setData(geo);
   if(!map.getLayer(layerId)){
    const type=l.id==='roads'?'line':(['buildings','water','parks'].includes(l.id)?'fill':'circle');
    const paint=type==='line'?{'line-color':l.color,'line-width':1.1,'line-opacity':0.65}:type==='fill'?{'fill-color':l.color,'fill-opacity':0.24}: {'circle-color':l.color,'circle-radius':4,'circle-stroke-color':'#101c2b','circle-stroke-width':1};
    map.addLayer({id:layerId,type,source:sourceId,filter:type==='fill'?['==',['geometry-type'],'Polygon']:type==='line'?['==',['geometry-type'],'LineString']:['==',['geometry-type'],'Point'],paint},'place-halos');
    // Polygon amenity geometries also appear as transparent outlines for inspection.
    if(['schools','healthcare','retail'].includes(l.id))map.addLayer({id:`outline-${l.id}`,type:'line',source:sourceId,filter:['==',['geometry-type'],'Polygon'],paint:{'line-color':l.color,'line-width':1.4}},'place-halos');
   }
   const show=enabled.includes(l.id)?'visible':'none';map.setLayoutProperty(layerId,'visibility',show);
   if(map.getLayer(`outline-${l.id}`))map.setLayoutProperty(`outline-${l.id}`,'visibility',show);
  }
 },[available,enabled,loaded]);
 const hasData=!!metrics?.locations?.length;
 return <div className="app"><header><div className="brand"><div className="brand-mark">G<span>●</span></div><div><strong>GeoIntel</strong><small>BENGALURU EXPLORER</small></div></div><div className="header-right"><span className="pill">PUBLIC DATA · EXPERIMENTAL</span><span className="version">MVP 0.3</span></div></header>
 <div className="workspace"><aside className="sidebar"><div className="eyebrow">LOCATION INTELLIGENCE</div><h1>Explore Bengaluru<br/><em>through data.</em></h1><p className="intro">Compare mapped amenities, infrastructure and land cover around five reference locations.</p>
 <label htmlFor="place">REFERENCE LOCATION</label><select id="place" value={selected} onChange={e=>setSelected(e.target.value)}>{places.map(p=><option key={p.location}>{p.location}</option>)}</select>
 <div className="section-head"><h2>Area indicators</h2><span>{hasData?'OSM-derived':'Awaiting data'}</span></div>
 <div className="metrics">{metricLabels.map(([key,label])=><div className="metric" key={key}><span>{label}</span><strong className={result?.metrics?.[key]?.status==='calculated'?'':'muted'}>{metricDisplay(key,result?.metrics?.[key])}</strong></div>)}</div>
 <p className="notice">{hasData?'Indicators describe mapped features, not verified real-world inventories.':'No live metrics have been published. Run the local data pipeline and export outputs to populate this dashboard.'}</p>
 </aside><main className="map-area"><div className="map" ref={mapEl}></div><div className="map-top"><div><strong>{selected}</strong><span>{selectedPlace.latitude.toFixed(4)}° N · {selectedPlace.longitude.toFixed(4)}° E</span></div></div>
 <div className="layer-panel"><div className="layer-title">MAP LAYERS <span>{Object.values(available).filter(g=>g.features?.length).length} with features</span></div>{layers.map(l=><label className="layer" key={l.id}><input type="checkbox" checked={enabled.includes(l.id)} onChange={e=>setEnabled(old=>e.target.checked?[...old,l.id]:old.filter(v=>v!==l.id))}/><span className="swatch" style={{background:l.color}}/>{l.label}<span className="layer-count">{available[l.id]?.features?.length??'—'}</span></label>)}</div>
 <div className="map-bottom">{mapError?<span className="error">{mapError}</span>:<span>Local vector layers · No third-party basemap</span>}<span>© OpenStreetMap contributors · ODbL</span></div></main></div>
 <footer><span>GeoIntel is a research prototype. Not for title, zoning, flood, or legal decisions.</span><span>{status?.generated_at_utc?`Data status generated ${new Date(status.generated_at_utc).toLocaleDateString()}`:'No published acquisition timestamp'}</span></footer></div>;
}
createRoot(document.getElementById('root')).render(<App/>);
