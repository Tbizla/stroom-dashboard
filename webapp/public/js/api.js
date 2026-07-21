export async function apiCall(url, method, body){
  const res = await fetch(url, { method, headers: body?{'Content-Type':'application/json'}:undefined, body: body?JSON.stringify(body):undefined });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || ('fout ' + res.status));
  return data;
}
