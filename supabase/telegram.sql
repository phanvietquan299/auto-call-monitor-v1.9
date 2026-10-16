begin;
create table if not exists call_monitor_private.remote_runtime(id boolean primary key default true check(id),device text,at bigint,snapshot jsonb);
create table if not exists call_monitor_private.remote_commands(id uuid primary key default gen_random_uuid(),dedupe text unique not null,payload jsonb not null,status text not null default 'PREVIEW',created_at bigint not null,claimed_by text,result jsonb);
create table if not exists call_monitor_private.remote_notices(id text primary key);
alter table call_monitor_private.remote_runtime enable row level security;
alter table call_monitor_private.remote_commands enable row level security;
alter table call_monitor_private.remote_notices enable row level security;
revoke all on all tables in schema call_monitor_private from public,anon,authenticated;
create or replace function public.call_monitor_remote(p_token text,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare now_ms bigint=(extract(epoch from clock_timestamp())*1000)::bigint; runtime call_monitor_private.remote_runtime; command call_monitor_private.remote_commands; fresh boolean; count_changed integer;
begin
 if p_token is null or not exists(select 1 from call_monitor_private.credentials where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')) then raise exception 'Access denied' using errcode='42501';end if;
 select * into runtime from call_monitor_private.remote_runtime where id=true;
 fresh=coalesce(runtime.at is not null and now_ms-runtime.at<45000,false);
 if p_action in ('heartbeat','publish') then
  if fresh and runtime.device<>p_payload->>'device' then raise exception 'Another extension is connected';end if;
  insert into call_monitor_private.remote_runtime(id,device,at,snapshot) values(true,p_payload->>'device',now_ms,p_payload->'snapshot') on conflict(id) do update set device=excluded.device,at=excluded.at,snapshot=case when coalesce((excluded.snapshot->>'capturedAt')::bigint,0)>=coalesce((call_monitor_private.remote_runtime.snapshot->>'capturedAt')::bigint,0) then excluded.snapshot else call_monitor_private.remote_runtime.snapshot end;
  if p_action='publish' then return '{}'::jsonb;end if;
  update call_monitor_private.remote_commands set status='EXPIRED' where status in ('PREVIEW','QUEUED') and now_ms-created_at>90000;
  select * into command from call_monitor_private.remote_commands where status='QUEUED' order by created_at for update skip locked limit 1;
  if command.id is not null then update call_monitor_private.remote_commands set status='RUNNING',claimed_by=p_payload->>'device' where id=command.id;return to_jsonb(command);end if;
  return 'null'::jsonb;
 elsif p_action='claim' then
  if not fresh or runtime.device<>p_payload->>'device' then raise exception 'Máy chưa đồng bộ dữ liệu; chờ kết nối';end if;
  update call_monitor_private.remote_commands set status='EXPIRED' where status in ('PREVIEW','QUEUED') and now_ms-created_at>90000;
  select * into command from call_monitor_private.remote_commands where status='QUEUED' order by created_at for update skip locked limit 1;
  if command.id is not null then update call_monitor_private.remote_commands set status='RUNNING',claimed_by=p_payload->>'device' where id=command.id;return to_jsonb(command);end if;
  return 'null'::jsonb;
 elsif p_action='snapshot' then return jsonb_build_object('online',fresh,'at',runtime.at,'snapshot',runtime.snapshot);
 elsif p_action='prepare' then
  if not fresh then raise exception 'Extension offline; mở Chrome và extension trước';end if;
  insert into call_monitor_private.remote_commands(dedupe,payload,created_at) values(p_payload->>'dedupe',p_payload->'command',now_ms) on conflict(dedupe) do nothing;
  select * into command from call_monitor_private.remote_commands where dedupe=p_payload->>'dedupe';return to_jsonb(command);
 elsif p_action='confirm' then
  if not fresh then raise exception 'Extension offline';end if;
  update call_monitor_private.remote_commands set status='QUEUED' where id=(p_payload->>'id')::uuid and status='PREVIEW' and now_ms-created_at<=90000;
  get diagnostics count_changed=row_count;if count_changed<>1 then raise exception 'Yêu cầu hết hạn hoặc đã xác nhận';end if;return jsonb_build_object('queued',true);
 elsif p_action='cancel' then
  update call_monitor_private.remote_commands set status='CANCELLED' where id=(p_payload->>'id')::uuid and status='PREVIEW';return '{}'::jsonb;
 elsif p_action='complete' then
  update call_monitor_private.remote_commands set status='DONE',result=p_payload->'result' where id=(p_payload->>'id')::uuid and status='RUNNING' and claimed_by=p_payload->>'device';get diagnostics count_changed=row_count;
  return jsonb_build_object('accepted',count_changed=1);
 elsif p_action='command-result' then
  select * into command from call_monitor_private.remote_commands where id=(p_payload->>'id')::uuid and status='DONE' and claimed_by=p_payload->>'device';return to_jsonb(command);
 elsif p_action='notice' then
  insert into call_monitor_private.remote_notices(id) values(p_payload->>'id') on conflict do nothing;get diagnostics count_changed=row_count;return jsonb_build_object('new',count_changed=1);
 elsif p_action='unnotice' then delete from call_monitor_private.remote_notices where id=p_payload->>'id';return '{}'::jsonb;
 else raise exception 'Invalid action';end if;
end $$;
revoke all on function public.call_monitor_remote(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.call_monitor_remote(text,text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
