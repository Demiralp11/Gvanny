const http = require('http');
const { WebSocketServer } = require('ws');
const server = http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/plain; charset=utf-8'});res.end('Granny multiplayer server is running');});
const wss = new WebSocketServer({server});
const rooms = new Map();
const send=(ws,obj)=>{if(ws.readyState===1)ws.send(JSON.stringify(obj));};
function roomPlayers(room){return [...room.players.values()].map(p=>({id:p.id,name:p.name}));}
function broadcast(room,obj,except=null){for(const p of room.players.values())if(p.ws!==except)send(p.ws,obj);}
wss.on('connection',ws=>{
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw);}catch{return;}
    if(m.type==='join'){
      const code=String(m.room||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);if(!code)return;
      let room=rooms.get(code);if(!room){room={players:new Map(),host:null,started:false};rooms.set(code,room);}
      if(room.players.size>=4){send(ws,{type:'error',message:'Oda dolu'});return;}
      const id=Math.random().toString(36).slice(2,10);const player={id,name:String(m.name||'Oyuncu').slice(0,16),ws,x:5.5,z:3,yaw:0};room.players.set(id,player);ws.room=code;ws.id=id;
      if(!room.host)room.host=id;
      send(ws,{type:'joined',id,host:room.host===id,count:room.players.size});
      broadcast(room,{type:'players',players:roomPlayers(room)});broadcast(room,{type:'host',id:room.host});if(room.started)send(ws,{type:'start'});return;
    }
    const room=rooms.get(ws.room);if(!room)return;const p=room.players.get(ws.id);if(!p)return;
    if(m.type==='player'){p.x=Number(m.x)||0;p.z=Number(m.z)||0;p.yaw=Number(m.yaw)||0;broadcast(room,{type:'player',id:p.id,name:p.name,x:p.x,z:p.z,yaw:p.yaw},ws);}
    if(m.type==='state'&&p.id===room.host)broadcast(room,{type:'state',state:m.state},ws);
    if(m.type==='start'){room.started=true;broadcast(room,{type:'start'});}
    if(m.type==='catch'&&p.id===room.host)broadcast(room,{type:'catch',target:m.target});
  });
  ws.on('close',()=>{const room=rooms.get(ws.room);if(!room)return;room.players.delete(ws.id);broadcast(room,{type:'left',id:ws.id});if(room.host===ws.id){room.host=room.players.keys().next().value||null;if(room.host)broadcast(room,{type:'host',id:room.host});}broadcast(room,{type:'players',players:roomPlayers(room)});if(!room.players.size)rooms.delete(ws.room);});
});
const port=process.env.PORT||3000;server.listen(port,'0.0.0.0',()=>console.log('Listening on '+port));
