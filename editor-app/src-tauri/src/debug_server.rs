// ============================================================
// debug_server.rs —— Agent 调试通道（Tauri 桌面版）
//   TCP server（std 线程，不引 tokio）+ 发现文件 + token 鉴权
//   模式：off / local（127.0.0.1）/ lan（0.0.0.0，强制 token）
//   流程：CLI 连入 → auth → 请求帧 {id,cmd,args} → emit 'debug://request'
//         → 前端执行 → invoke 'debug_reply' → 本模块路由写回对应连接
//   事件：前端 invoke 'debug_emit' → 广播给所有已认证连接
//   启动：设置页开关调 debug_server_control；或环境变量 WRITEIT_DEBUG(=local/lan)
// ============================================================
use serde::Serialize;
use serde_json::{json, Value};
use std::{
  fs,
  io::{BufRead, BufReader, Write},
  net::{TcpListener, TcpStream},
  sync::{
    atomic::{AtomicU64, Ordering},
    mpsc::{channel, Sender},
    Mutex,
  },
  thread,
  time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};

/// 每连接一个写通道（writer 线程持有 TcpStream 副本）+ 存活标志
#[derive(Clone)]
struct ConnSink {
  tx: Sender<String>,
  alive: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl ConnSink {
  fn new(tx: Sender<String>) -> Self {
    Self { tx, alive: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true)) }
  }
  fn send(&self, s: String) {
    if self.alive.load(std::sync::atomic::Ordering::SeqCst) {
      let _ = self.tx.send(s);
    }
  }
  fn mark_dead(&self) {
    self.alive.store(false, std::sync::atomic::Ordering::SeqCst);
  }
}

#[derive(Default)]
pub struct DebugServerState {
  /// 当前 token（重启后失效）
  pub token: Mutex<String>,
  /// 监听句柄（off 时 None）
  pub listener: Mutex<Option<TcpListener>>,
  /// globalId → 写通道（请求回路由）
  pub pending: Mutex<std::collections::HashMap<u64, ConnSink>>,
  /// 已认证会话（事件广播目标）
  pub sessions: Mutex<Vec<ConnSink>>,
  pub next_id: AtomicU64,
  pub mode: Mutex<String>,
  /// 实例标识（启动时生成一次，设置页展示，CLI/Agent 用其指认实例）
  pub instance_id: Mutex<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RequestPayload {
  id: u64,
  cmd: String,
  args: Value,
}

fn random_token() -> String {
  // 无 rand 依赖：用时间 + 自增种子做个简单 xorshift，取 16 hex
  let mut seed = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_nanos() as u64)
    .unwrap_or(0x9e3779b9)
    | 1;
  let mut out = String::new();
  for _ in 0..16 {
    // xorshift64
    seed ^= seed << 13;
    seed ^= seed >> 7;
    seed ^= seed << 17;
    out.push_str(&format!("{:x}", seed & 0xf));
  }
  out
}

/// 实例标识：w{pid}-{8位hex}（进程启动即定，设置页展示给用户，Agent 凭此指认实例）
fn boot_instance_id() -> String {
  let pid = std::process::id();
  let t = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_nanos())
    .unwrap_or(0);
  // 取时间低 32 位的 hex，尽量短且可辨别
  format!("w{}-{:08x}", pid, (t as u64) & 0xffff_ffff)
}

/// 发现文件路径：app_config_dir/debug.json
fn discovery_path(app: &AppHandle) -> Option<std::path::PathBuf> {
  app.path().app_config_dir().ok().map(|d| d.join("debug.json"))
}

/// 实例注册表目录：app_config_dir/debug_instances/
fn registry_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
  app.path().app_config_dir().ok().map(|d| d.join("debug_instances"))
}

fn instance_file(app: &AppHandle, id: &str) -> Option<std::path::PathBuf> {
  registry_dir(app).map(|d| d.join(format!("{id}.json")))
}

/// 写本实例注册文件（多实例并存互不覆盖；CLI 扫描目录 + PID 探活来列实例）
fn write_registry(app: &AppHandle, state: &DebugServerState) {
  let Some(dir) = registry_dir(app) else { return };
  let _ = fs::create_dir_all(&dir);
  let Some(file) = instance_file(app, &state.instance_id.lock().unwrap_or_else(|e| e.into_inner())) else { return };
  let info = json!({
    "instanceId": state.instance_id.lock().unwrap_or_else(|e| e.into_inner()).clone(),
    "pid": std::process::id(),
    "port": state.listener.lock().ok()
      .and_then(|g| g.as_ref().and_then(|l| l.local_addr().ok()).map(|a| a.port()))
      .unwrap_or(0),
    "token": state.token.lock().unwrap_or_else(|e| e.into_inner()).clone(),
    "mode": state.mode.lock().unwrap_or_else(|e| e.into_inner()).clone(),
    "at": now_iso(),
  });
  if let Err(e) = fs::write(&file, info.to_string()) {
    eprintln!("[debug_server] 写注册文件失败 {file:?}: {e}");
  }
}

fn remove_registry(app: &AppHandle, state: &DebugServerState) {
  let id = state.instance_id.lock().unwrap_or_else(|e| e.into_inner()).clone();
  if let Some(p) = instance_file(app, &id) {
    let _ = fs::remove_file(p);
  }
}

fn write_discovery(app: &AppHandle, mode: &str, port: u16, token: &str, instance_id: &str) {
  let Some(p) = discovery_path(app) else { return };
  if let Some(dir) = p.parent() {
    let _ = fs::create_dir_all(dir);
  }
  let info = json!({
    "pid": std::process::id(),
    "port": port,
    "token": token,
    "mode": mode,
    "instanceId": instance_id,
    "at": now_iso(),
  });
  if let Err(e) = fs::write(&p, info.to_string()) {
    eprintln!("[debug_server] 写发现文件失败 {p:?}: {e}");
  }
}

fn remove_discovery(app: &AppHandle) {
  if let Some(p) = discovery_path(app) {
    let _ = fs::remove_file(p);
  }
}

pub fn start_server(app: &AppHandle, state: &DebugServerState, mode: &str) -> Result<(), String> {
  stop_server(app, state);
  let mode = mode.to_string(); // 转 owned，便于 move 进后台线程（避免 &str 逃逸生命周期报错）
  // 实例标识：进程内首启时生成，之后保持不变（设置页/Agent 指认用）
  {
    let mut id = state.instance_id.lock().map_err(|e| e.to_string())?;
    if id.is_empty() {
      *id = boot_instance_id();
    }
  }
  let bind_addr = if mode == "lan" { "0.0.0.0:0" } else { "127.0.0.1:0" };
  let listener = TcpListener::bind(bind_addr).map_err(|e| format!("绑定 {bind_addr} 失败: {e}"))?;
  let port = listener.local_addr().map_err(|e| e.to_string())?.port();
  let token = random_token();
  *state.token.lock().map_err(|e| e.to_string())? = token.clone();
  *state.mode.lock().map_err(|e| e.to_string())? = mode.to_string();
  *state.listener.lock().map_err(|e| e.to_string())? = Some(listener.try_clone().map_err(|e| e.to_string())?);
  let instance_id = state.instance_id.lock().map_err(|e| e.to_string())?.clone();
  write_discovery(app, &mode, port, &token, &instance_id);
  write_registry(app, state);

  let app2 = app.clone();
  thread::spawn(move || {
    let st = app2.state::<DebugServerState>();
    let Some(l) = st.listener.lock().ok().and_then(|g| g.as_ref().and_then(|l| l.try_clone().ok())) else { return };
    // 非阻塞 accept + 轮询：stop_server 置 None 后线程能退出，真正解绑端口
    let _ = l.set_nonblocking(true);
    eprintln!("[debug_server] 监听 {mode} :{port} token={token}");
    loop {
      let running = st.listener.lock().ok().map(|g| g.is_some()).unwrap_or(false);
      if !running {
        break;
      }
      match l.accept() {
        Ok((stream, _)) => {
          let app3 = app2.clone();
          thread::spawn(move || handle_conn(stream, &app3));
        }
        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
          thread::sleep(Duration::from_millis(50));
        }
        Err(_) => break,
      }
    }
  });
  Ok(())
}

pub fn stop_server(app: &AppHandle, state: &DebugServerState) {
  if let Ok(mut g) = state.listener.lock() {
    *g = None; // 关闭监听；已有连接各自超时/断开
  }
  if let Ok(mut s) = state.sessions.lock() {
    s.clear();
  }
  if let Ok(mut p) = state.pending.lock() {
    p.clear();
  }
  *state.token.lock().unwrap_or_else(|e| e.into_inner()) = String::new();
  remove_registry(app, state);
}

/// 处理单条连接（reader 线程 + writer 线程分离）
fn handle_conn(stream: TcpStream, app: &AppHandle) {
  let Ok(write_stream) = stream.try_clone() else { return };
  let (tx, rx) = channel::<String>();
  thread::spawn(move || {
    for msg in rx {
      if write_stream.write_all(msg.as_bytes()).is_err() {
        break;
      }
    }
  });

  let state = app.state::<DebugServerState>();
  let mut authed = false;
  let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
  let mut reader = BufReader::new(stream);
  let mut line = String::new();
  let conn = ConnSink::new(tx);

  loop {
    line.clear();
    match reader.read_line(&mut line) {
      Ok(0) | Err(_) => break, // EOF / 超时（超时无数据视为空闲，继续）
      Ok(_) => {
        let trimmed = line.trim();
        if trimmed.is_empty() {
          continue;
        }
        let Ok(frame) = serde_json::from_str::<Value>(trimmed) else {
          let _ = conn.send(json!({"ok": false, "error": "invalid json"}).to_string() + "\n");
          continue;
        };
        let cmd = frame.get("cmd").and_then(|c| c.as_str()).unwrap_or("");
        let id = frame.get("id").and_then(|i| i.as_u64()).unwrap_or(0);
        let args = frame.get("args").cloned().unwrap_or(Value::Null);

        if cmd == "auth" {
          let token_ok = args.get("token").and_then(|t| t.as_str()) == Some(state.token.lock().unwrap_or_else(|e| e.into_inner()).as_str());
          if token_ok {
            authed = true;
            if let Ok(mut s) = state.sessions.lock() {
              s.push(conn.clone());
            }
            let _ = conn.send(json!({"id": id, "ok": true, "data": {"authed": true}}).to_string() + "\n");
          } else {
            let _ = conn.send(json!({"id": id, "ok": false, "error": "auth failed"}).to_string() + "\n");
            eprintln!("[debug_server] 鉴权失败，断开");
            break;
          }
          continue;
        }

        if !authed {
          break; // 未 auth 非 auth 帧 → 断开
        }

        // 普通请求：分配全局 id，转发前端
        let gid = state.next_id.fetch_add(1, Ordering::SeqCst);
        {
          if let Ok(mut p) = state.pending.lock() {
            p.insert(gid, conn.clone());
          }
        }
        let payload = RequestPayload { id: gid, cmd: cmd.to_string(), args };
        let _ = app.emit_to("main", "debug://request", payload);
        // 兜底超时：15s 无回 → 回 timeout 并清理（前端正常回会被 pending 覆盖）
        let st2 = app.state::<DebugServerState>();
        let conn2 = conn.clone();
        thread::spawn(move || {
          thread::sleep(Duration::from_secs(15));
          let removed = {
            let mut p = st2.pending.lock().unwrap_or_else(|e| e.into_inner());
            p.remove(&gid).is_some()
          };
          if removed {
            let _ = conn2.send(json!({"id": id, "ok": false, "error": "timeout (15s)"}).to_string() + "\n");
          }
        });
      }
    }
  }

  // 连接退出：清理该会话与它的 pending（alive=false 后由各持有方校验）
  conn.mark_dead();
  {
    let mut sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
    sessions.retain(|s| s.alive.load(std::sync::atomic::Ordering::SeqCst));
  }
  {
    let mut p = state.pending.lock().unwrap_or_else(|e| e.into_inner());
    p.retain(|_, s| s.alive.load(std::sync::atomic::Ordering::SeqCst));
  }
}

/// 前端回传命令结果：按全局 id 路由到对应连接
#[tauri::command]
pub fn debug_reply(
  state: State<'_, DebugServerState>,
  id: u64,
  ok: bool,
  data: Option<Value>,
  error: Option<String>,
) -> Result<(), String> {
  let frame = json!({"id": id, "ok": ok, "data": data.unwrap_or(Value::Null), "error": error});
  let sink = {
    let mut p = state.pending.lock().map_err(|e| e.to_string())?;
    p.remove(&id)
  };
  if let Some(s) = sink {
    s.send(frame.to_string());
  }
  Ok(())
}

/// 前端推事件：广播给所有已认证连接
#[tauri::command]
pub fn debug_emit(state: State<'_, DebugServerState>, event: Value) -> Result<(), String> {
  let frame = json!({"event": "push", "payload": event}).to_string();
  let sessions = {
    let s = state.sessions.lock().map_err(|e| e.to_string())?;
    s.clone()
  };
  for s in sessions {
    let _ = s.send(frame.clone());
  }
  Ok(())
}

/// 控制调试通道：off / local / lan
#[tauri::command]
pub fn debug_server_control(app: AppHandle, state: State<'_, DebugServerState>, mode: String) -> Result<Value, String> {
  match mode.as_str() {
    "off" => {
      stop_server(&app, &state);
      remove_discovery(&app);
      Ok(json!({"mode": "off", "instanceId": state.instance_id.lock().map_err(|e| e.to_string())?.clone()}))
    }
    "local" | "lan" => {
      start_server(&app, &state, &mode)?;
      let token = state.token.lock().map_err(|e| e.to_string())?.clone();
      let instance_id = state.instance_id.lock().map_err(|e| e.to_string())?.clone();
      Ok(json!({"mode": mode, "port": 0, "token": token, "instanceId": instance_id}))
    }
    other => Err(format!("未知模式: {other}")),
  }
}

/// 查询当前状态（设置页显示用；含实例标识与根目录）
#[tauri::command]
pub fn debug_server_status(
  app: AppHandle,
  state: State<'_, DebugServerState>,
  app_state: State<'_, crate::AppState>,
) -> Result<Value, String> {
  // 实例标识：进程内首查时生成（保证设置页始终可见，不依赖调试通道是否开启）
  {
    let mut id = state.instance_id.lock().map_err(|e| e.to_string())?;
    if id.is_empty() {
      *id = boot_instance_id();
    }
  }
  let mode = state.mode.lock().map_err(|e| e.to_string())?.clone();
  let token = state.token.lock().map_err(|e| e.to_string())?.clone();
  let sessions = state.sessions.lock().map_err(|e| e.to_string())?.len();
  let instance_id = state.instance_id.lock().map_err(|e| e.to_string())?.clone();
  let root = app_state.root.lock().ok().and_then(|r| r.clone()).map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
  Ok(json!({
    "mode": mode,
    "token": token,
    "sessions": sessions,
    "instanceId": instance_id,
    "pid": std::process::id(),
    "root": root,
  }))
}

fn now_iso() -> String {
  let d = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|x| x.as_secs())
    .unwrap_or(0);
  format!("unix:{d}")
}