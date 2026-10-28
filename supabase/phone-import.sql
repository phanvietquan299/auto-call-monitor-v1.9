-- Extend existing authenticated commands without touching passwords, sessions or bot settings.
begin;
do $migration$
declare definition text; needle text;
begin
 definition:=pg_get_functiondef('public.call_monitor_mobile(text,text,jsonb)'::regprocedure);
 if position('PHONE_IMPORT_PREVIEW' in definition)=0 then
  needle:='''FS_SWITCH_RELEASE''';
  if position(needle in definition)=0 then raise exception 'Mobile command whitelist changed; review migration';end if;
  definition:=replace(definition,needle,'''FS_SWITCH_RELEASE'',''PHONE_IMPORT_PREVIEW'',''PHONE_IMPORT_EXECUTE''');
  needle:='  insert into call_monitor_private.remote_commands(dedupe,payload,status,created_at)';
  if position(needle in definition)=0 then raise exception 'Mobile command insert changed; review migration';end if;
  definition:=replace(definition,needle,$guard$
  if p_payload->'command'->>'type'='PHONE_IMPORT_PREVIEW' then
   if not coalesce(p_payload->'command'->>'selectedSheet'=any(array['coll','tls','both']),false) or jsonb_typeof(p_payload->'command'->'entries') is distinct from 'array' then raise exception 'Danh sách nạp không hợp lệ';end if;
   if jsonb_array_length(p_payload->'command'->'entries') not between 1 and 10000 or octet_length((p_payload->'command')::text)>300000 then raise exception 'Danh sách nạp quá lớn';end if;
  end if;
$guard$||needle);
  execute definition;
 end if;
 definition:=pg_get_functiondef('public.call_monitor_mobile(text,text,jsonb)'::regprocedure);
 needle:='array[''coll'',''tls'']';
 if position(needle in definition)>0 then
  definition:=replace(definition,needle,'array[''coll'',''tls'',''both'']');execute definition;
 end if;
 definition:=pg_get_functiondef('public.call_monitor_remote(text,text,jsonb)'::regprocedure);
 if position('payload-''entries''' in definition)=0 then
  needle:='set status=''DONE'',result=p_payload->''result'' where';
  if position(needle in definition)=0 then raise exception 'Remote result clause changed; review migration';end if;
  definition:=replace(definition,needle,'set status=''DONE'',result=p_payload->''result'',payload=case when payload->>''type''=''PHONE_IMPORT_PREVIEW'' then payload-''entries'' else payload end where');
  definition:=replace(definition,'set status=''EXPIRED'' where','set status=''EXPIRED'',payload=case when payload->>''type''=''PHONE_IMPORT_PREVIEW'' then payload-''entries'' else payload end where');
  execute definition;
 end if;
end $migration$;
notify pgrst,'reload schema';
commit;
