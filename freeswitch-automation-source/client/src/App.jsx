import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { Server, Phone, RefreshCw, Activity, Clock, PlusCircle, Upload, X } from 'lucide-react';

const socket = io();

export default function App() {
  const [nodes, setNodes] = useState([]);
  const [numbers, setNumbers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [selectedNode, setSelectedNode] = useState('ALL');
  const [loading, setLoading] = useState(false);

  // Modal import state
  const [showImport, setShowImport] = useState(false);
  const [importNode, setImportNode] = useState('FS01');
  const [importProfile, setImportProfile] = useState('COLLECTION');
  const [importText, setImportText] = useState('');

  const fetchData = async () => {
    try {
      const [resNodes, resNums, resLogs] = await Promise.all([
        axios.get('/api/nodes'),
        axios.get('/api/numbers'),
        axios.get('/api/logs')
      ]);
      setNodes(resNodes.data);
      setNumbers(resNums.data);
      setLogs(resLogs.data);
    } catch (err) {
      console.error("Lỗi lấy dữ liệu:", err);
    }
  };

  useEffect(() => {
    fetchData();
    socket.on('node_status_changed', () => fetchData());
    socket.on('number_swapped', () => fetchData());

    return () => {
      socket.off('node_status_changed');
      socket.off('number_swapped');
    };
  }, []);

  const handleStatusChange = async (nodeId, newStatus) => {
    try {
      await axios.post('/api/nodes/update-status', { nodeId, status: newStatus });
      fetchData();
    } catch (err) {
      alert("Lỗi đổi trạng thái Node: " + err.message);
    }
  };

  const handleManualSwap = async (nodeId, phone) => {
    if (!confirm(`Bạn có chắc muốn ĐỔI SỐ ${phone} trên Node ${nodeId}?`)) return;
    setLoading(true);
    try {
      const res = await axios.post('/api/swap', {
        nodeId,
        phone,
        type: 'MANUAL',
        operator: 'Admin_Web'
      });
      alert(`✅ Đổi số thành công! Số mới: ${res.data.newPhone}`);
      fetchData();
    } catch (err) {
      alert(`❌ Lỗi: ${err.response?.data?.message || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleImportSubmit = async (e) => {
    e.preventDefault();
    const phoneList = importText.split(/[\n,;]+/).map(p => p.trim()).filter(Boolean);
    if (phoneList.length === 0) {
      alert("Vui lòng nhập ít nhất 1 số điện thoại!");
      return;
    }

    try {
      await axios.post('/api/numbers/add', {
        nodeId: importNode,
        profile: importProfile,
        phones: phoneList
      });
      alert(`✅ Đã nạp thêm ${phoneList.length} SĐT vào Node ${importNode}`);
      setShowImport(false);
      setImportText('');
      fetchData();
    } catch (err) {
      alert("❌ Lỗi nạp SĐT: " + err.message);
    }
  };

  const filteredNumbers = selectedNode === 'ALL' 
    ? numbers 
    : numbers.filter(n => n.node_id === selectedNode);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 md:p-6 font-sans">
      <header className="flex justify-between items-center mb-6 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <Server className="w-8 h-8 text-blue-500" />
          <div>
            <h1 className="text-xl md:text-2xl font-bold">FreeSWITCH Control Center</h1>
            <p className="text-xs text-slate-400">Hệ thống Quản lý 8 Node & Đổi số Tự động/Thủ công</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition shadow"
          >
            <PlusCircle className="w-4 h-4" /> Bổ Sung SĐT
          </button>
          <button 
            onClick={fetchData} 
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 transition"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Quản lý Node Dạng Bảng Hàng Ngang */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-emerald-400" /> Danh Sách & Trạng Thái Node FreeSWITCH
        </h2>
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-x-auto shadow-lg">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/80 text-xs uppercase text-slate-400 border-b border-slate-700">
              <tr>
                <th className="p-3">Tên Node</th>
                <th className="p-3">Địa Chỉ IP</th>
                <th className="p-3">Trạng Thái ESL (Health)</th>
                <th className="p-3">Chế Độ Vận Hành</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {nodes.map((node) => (
                <tr key={node.id} className="hover:bg-slate-700/30 transition">
                  <td className="p-3 font-bold text-blue-400">{node.id}</td>
                  <td className="p-3 font-mono text-xs text-slate-300">{node.host}:{node.port}</td>
                  <td className="p-3">
                    <span className={`px-2.5 py-1 text-xs font-bold rounded-full inline-flex items-center gap-1.5 ${
                      node.health === 'UP' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    }`}>
                      <span className={`w-2 h-2 rounded-full ${node.health === 'UP' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`}></span>
                      {node.health === 'UP' ? 'ONLINE (UP)' : 'OFFLINE (DOWN)'}
                    </span>
                  </td>
                  <td className="p-3">
                    <select
                      value={node.status}
                      onChange={(e) => handleStatusChange(node.id, e.target.value)}
                      className="bg-slate-900 border border-slate-700 text-xs rounded-lg p-1.5 text-slate-200 focus:outline-none focus:border-blue-500"
                    >
                      <option value="FULL_ONLINE">🟢 FULL_ONLINE (Auto + Manual)</option>
                      <option value="MANUAL_ONLY">🟡 MANUAL_ONLY (Chỉ đổi tay)</option>
                      <option value="MAINTENANCE">🔴 MAINTENANCE (Tắt hẳn)</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Danh Sách SĐT */}
      <section className="mb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Phone className="w-5 h-5 text-blue-400" /> Danh Sách Số Điện Thoại (Phone Pool)
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">Lọc Node:</span>
            <select
              value={selectedNode}
              onChange={(e) => setSelectedNode(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-sm rounded-lg p-2 text-slate-200"
            >
              <option value="ALL">Tất cả Node</option>
              {nodes.map(n => <option key={n.id} value={n.id}>{n.id}</option>)}
            </select>
          </div>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-x-auto shadow-lg">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/80 text-xs uppercase text-slate-400 border-b border-slate-700">
              <tr>
                <th className="p-3">SĐT</th>
                <th className="p-3">Node</th>
                <th className="p-3">Profile</th>
                <th className="p-3">Trạng thái</th>
                <th className="p-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {filteredNumbers.map((num) => (
                <tr key={num.id} className="hover:bg-slate-700/30 transition">
                  <td className="p-3 font-mono font-medium text-slate-100">{num.phone}</td>
                  <td className="p-3"><span className="bg-slate-700 px-2 py-0.5 rounded text-xs">{num.node_id}</span></td>
                  <td className="p-3 text-xs text-slate-400">{num.profile}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 text-xs font-semibold rounded ${
                      num.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-400' :
                      num.status === 'BACKUP' ? 'bg-blue-500/20 text-blue-400' :
                      'bg-rose-500/20 text-rose-400'
                    }`}>
                      {num.status}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    {num.status === 'ACTIVE' && (
                      <button
                        disabled={loading}
                        onClick={() => handleManualSwap(num.node_id, num.phone)}
                        className="bg-rose-600 hover:bg-rose-500 text-white text-xs px-3 py-1.5 rounded-lg font-medium transition shadow disabled:opacity-50"
                      >
                        ⚡ Đổi Số Ngay
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Lịch Sử */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-amber-400" /> Lịch Sử Đổi Số Gần Đây
        </h2>
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 max-h-60 overflow-y-auto space-y-2">
          {logs.length === 0 ? (
            <p className="text-xs text-slate-500">Chưa có lịch sử đổi số nào.</p>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex justify-between items-center text-xs bg-slate-900/60 p-2.5 rounded-lg border border-slate-700/30">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-blue-400">[{log.node_id}]</span>
                  <span className="line-through text-rose-400">{log.old_phone}</span>
                  <span>➔</span>
                  <span className="font-bold text-emerald-400">{log.new_phone}</span>
                  <span className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">({log.swap_type})</span>
                </div>
                <div className="text-slate-500 text-[11px]">{log.created_at} - Op: {log.operator}</div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Modal Upload / Bổ Sung SĐT */}
      {showImport && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl relative">
            <button 
              onClick={() => setShowImport(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-200"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Upload className="w-5 h-5 text-blue-400" /> Bổ Sung SĐT Về Phone Pool
            </h3>
            
            <form onSubmit={handleImportSubmit} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Chọn Node gán SĐT:</label>
                <select 
                  value={importNode}
                  onChange={(e) => setImportNode(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-sm rounded-lg p-2 text-slate-200"
                >
                  {nodes.map(n => <option key={n.id} value={n.id}>{n.id}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">SIP Profile:</label>
                <input 
                  type="text" 
                  value={importProfile} 
                  onChange={(e) => setImportProfile(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-sm rounded-lg p-2 text-slate-200"
                  placeholder="Ví dụ: COLLECTION, external..."
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Danh sách SĐT (mỗi số 1 dòng hoặc cách nhau dấu phẩy):</label>
                <textarea 
                  rows="6"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-sm rounded-lg p-2 text-slate-200 font-mono"
                  placeholder={"0968111222\n0968333444\n0968555666"}
                ></textarea>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button 
                  type="button" 
                  onClick={() => setShowImport(false)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-semibold"
                >
                  Hủy
                </button>
                <button 
                  type="submit" 
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold text-white shadow"
                >
                  Lưu SĐT
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
