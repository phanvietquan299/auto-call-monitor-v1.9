begin;
create table if not exists call_monitor_private.mobile_access(code_hash text primary key,code_expires bigint not null,session_hash text unique,session_expires bigint);
alter table call_monitor_private.mobile_access enable row level security;
revoke all on call_monitor_private.mobile_access from public,anon,authenticated;
create table if not exists call_monitor_private.mobile_password(id boolean primary key default true check(id),password_hash text not null,failures integer not null default 0,locked_until bigint not null default 0);
alter table call_monitor_private.mobile_password enable row level security;
revoke all on call_monitor_private.mobile_password from public,anon,authenticated;
create or replace function public.call_monitor_mobile_link(p_token text,p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_token is null or not exists(select 1 from call_monitor_private.credentials where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')) then raise exception 'Access denied' using errcode='42501';end if;
 delete from call_monitor_private.mobile_access where coalesce(session_expires,code_expires)<(extract(epoch from clock_timestamp())*1000)::bigint;
 insert into call_monitor_private.mobile_access(code_hash,code_expires) values(encode(sha256(convert_to(p_code,'UTF8')),'hex'),(extract(epoch from clock_timestamp())*1000)::bigint+300000);
 return '{}'::jsonb;
end $$;
create or replace function public.call_monitor_mobile(p_token text,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare t bigint=(extract(epoch from clock_timestamp())*1000)::bigint; session text; n integer; runtime call_monitor_private.remote_runtime; command call_monitor_private.remote_commands; result jsonb; start_ms bigint; end_ms bigint; auth call_monitor_private.mobile_password; password text;
begin
 if p_action='set_password' then
  if p_token is null or not (exists(select 1 from call_monitor_private.credentials where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')) or exists(select 1 from call_monitor_private.mobile_access where session_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and session_expires>t)) then raise exception 'Access denied' using errcode='42501';end if;
  password=p_payload->>'password';
  if password is null or length(password)<10 or octet_length(password)>72 then raise exception 'Mật khẩu cần ít nhất 10 ký tự, tối đa 72 byte.';end if;
  insert into call_monitor_private.mobile_password(id,password_hash) values(true,extensions.crypt(password,extensions.gen_salt('bf',12))) on conflict(id) do update set password_hash=excluded.password_hash,failures=0,locked_until=0;
  delete from call_monitor_private.mobile_access where session_hash is distinct from encode(sha256(convert_to(p_token,'UTF8')),'hex');
  return jsonb_build_object('ok',true);
 elsif p_action='password_login' then
  select * into auth from call_monitor_private.mobile_password where id=true for update;
  if not found then return jsonb_build_object('ok',false,'error','Chưa đặt mật khẩu. Đăng nhập bằng liên kết một lần rồi chọn Mật khẩu.');end if;
  if auth.locked_until>t then return jsonb_build_object('ok',false,'error','Nhập sai nhiều lần. Thử lại sau 1 phút.');end if;
  password=coalesce(p_payload->>'password','');
  if octet_length(password)>72 or extensions.crypt(password,auth.password_hash) is distinct from auth.password_hash then
   update call_monitor_private.mobile_password set failures=case when failures>=4 then 0 else failures+1 end,locked_until=case when failures>=4 then t+60000 else 0 end where id=true;
   return jsonb_build_object('ok',false,'error','Mật khẩu không đúng.');
  end if;
  update call_monitor_private.mobile_password set failures=0,locked_until=0 where id=true;
  session=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  delete from call_monitor_private.mobile_access where coalesce(session_expires,code_expires)<t;
  insert into call_monitor_private.mobile_access(code_hash,code_expires,session_hash,session_expires) values(encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex'),t,encode(sha256(convert_to(session,'UTF8')),'hex'),t+2592000000);
  return jsonb_build_object('ok',true,'session',session,'expires',t+2592000000);
 end if;
 if p_action='exchange' then
  session=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  update call_monitor_private.mobile_access set session_hash=encode(sha256(convert_to(session,'UTF8')),'hex'),session_expires=t+43200000 where code_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and code_expires>t and session_hash is null;
  get diagnostics n=row_count;if n<>1 then raise exception 'Liên kết hết hạn hoặc đã dùng. Gửi /app cho bot để lấy liên kết mới.' using errcode='42501';end if;
  return jsonb_build_object('session',session,'expires',t+43200000);
 end if;
 if p_token is null or not exists(select 1 from call_monitor_private.mobile_access where session_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and session_expires>t) then raise exception 'Phiên đăng nhập hết hạn. Nhập mật khẩu để đăng nhập lại.' using errcode='42501';end if;
 select * into runtime from call_monitor_private.remote_runtime where id=true;
 if p_action='state' then return jsonb_build_object('online',runtime.at is not null and t-runtime.at<45000,'at',runtime.at,'snapshot',runtime.snapshot);
 elsif p_action='command' then
  if runtime.at is null or t-runtime.at>=45000 then raise exception 'Máy đang offline';end if;
  if not coalesce(p_payload->'command'->>'type'=any(array['MANUAL_FS_STATUS','DISMISS_CDR_WARNING','SET_MONITORING','SET_AUTO','SET_AUTO_BLOCK_MODE','CONFIRM_AUTO_BLOCK','CANCEL_AUTO_BLOCK','RECHECK_AUTO_BLOCK','ACK_MANUAL_AFTER_FAILURE','REPORT_MANUAL_SWAP','CLEAR_HISTORY','FS_SWITCH_SETTINGS','FS_SWITCH_THRESHOLD','FS_SWITCH_PRESET','FS_SWITCH_RELOAD','FS_SWITCH_TOGGLE_NODE','FS_SWITCH_CONFIRM','FS_SWITCH_RELEASE']),false) then raise exception 'Lệnh không hợp lệ';end if;
  insert into call_monitor_private.remote_commands(dedupe,payload,status,created_at) values('mobile:'||(p_payload->>'id'),p_payload->'command','QUEUED',t) on conflict(dedupe) do nothing;
  select * into command from call_monitor_private.remote_commands where dedupe='mobile:'||(p_payload->>'id');return jsonb_build_object('id',command.id,'status',command.status);
 elsif p_action='result' then
  select * into command from call_monitor_private.remote_commands where id=(p_payload->>'id')::uuid and dedupe like 'mobile:%';
  return jsonb_build_object('status',command.status,'result',command.result);
 elsif p_action='history' then
  start_ms=(p_payload->>'start')::bigint;end_ms=(p_payload->>'end')::bigint;
  select coalesce(jsonb_agg(x.event),'[]'::jsonb) into result from(select event from call_monitor_private.history where (start_ms is null or at>=start_ms) and (end_ms is null or at<end_ms) order by at desc,id limit 500 offset greatest(0,coalesce((p_payload->>'offset')::integer,0)))x;
  return result;
 else raise exception 'Invalid mobile action';end if;
end $$;
revoke all on function public.call_monitor_mobile_link(text,text) from public,anon,authenticated;
revoke all on function public.call_monitor_mobile(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.call_monitor_mobile_link(text,text) to anon,authenticated;
grant execute on function public.call_monitor_mobile(text,text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
