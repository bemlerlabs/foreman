import http from 'node:http'; import fs from 'node:fs';
http.createServer((_q,res)=>{res.setHeader('content-type','text/html');res.end(fs.readFileSync('index.html'))}).listen(8788,'127.0.0.1',()=>console.log('key-grant auf http://127.0.0.1:8788'));
