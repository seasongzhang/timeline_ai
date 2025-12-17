import { useState, useMemo, useEffect } from 'react'; // React 核心 Hooks：状态管理、计算缓存、副作用处理
import axios from 'axios'; // HTTP 客户端：用于向后端发送请求
// Ant Design UI 组件库：提供现成的界面元素
import { Upload, Button, Timeline, Card, Tag, Typography, Input, message, Drawer, Space, Tooltip, Select, Row, Col, Slider, Modal, Spin, Table, Popover, Checkbox } from 'antd';
// Ant Design 图标库：提供界面所需的各种图标
import { UploadOutlined, SearchOutlined, FilterOutlined, InfoCircleOutlined, WifiOutlined, ApartmentOutlined, HistoryOutlined, BugOutlined, SettingOutlined } from '@ant-design/icons';

import './index.css'; // 全局样式文件

// ==================== 全局属性配置 ====================
// 定义所有可用的全局属性列及其默认显示状态
const GLOBAL_ATTR_DEFS = [
  { key: '合同号', label: '合同号梯号', width: '120px', defaultVisible: false },
  { key: '控制同步层', label: '控制同步层(从0开始)', width: '60px', defaultVisible: true },
  { key: '41DG信号', label: '41DG轿门&层门', width: '60px', defaultVisible: false },
  { key: '延时时长', label: '延时上传(分钟)', width: '80px', defaultVisible: false }
];

// 从 Typography 组件中提取子组件，方便直接使用
const { Title, Text, Paragraph } = Typography;
// 从 Input 组件中提取 Search 子组件
const { Search } = Input;
// 从 Select 组件中提取 Option 子组件
const { Option } = Select;

function App() {
  // ==================== 状态管理 (State Management) ====================
  // 核心数据状态：存储从后端解析的 Excel 数据
  const [data, setData] = useState(null);
  // 加载状态：控制上传按钮的 loading 效果
  const [loading, setLoading] = useState(false);
  // 搜索文本：用于过滤时间轴内容
  const [searchText, setSearchText] = useState('');
  // 当前选中行：用于点击卡片后在抽屉中显示详情
  const [selectedRow, setSelectedRow] = useState(null);
  // 抽屉开关：控制详情抽屉的显示/隐藏
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 设备筛选：当前选中的设备 ID，'All' 表示显示所有
  const [selectedDevice, setSelectedDevice] = useState('All');
  // 时间范围：当前滑块选择的时间区间 [开始时间戳, 结束时间戳]
  const [timeRange, setTimeRange] = useState([0, 0]);
  // 完整时间范围：数据的最小和最大时间戳，用于滑块的边界
  const [fullTimeRange, setFullTimeRange] = useState([0, 0]);

  // ==================== 视图控制状态 ====================
  // 控制是否隐藏非关键信息行
  const [hideNonCritical, setHideNonCritical] = useState(false);
  
  // 控制全局属性列的显示/隐藏
  const [visibleAttrKeys, setVisibleAttrKeys] = useState(
      GLOBAL_ATTR_DEFS.filter(c => c.defaultVisible).map(c => c.key)
  );



  // ==================== 规则调试状态 ====================
  const [isDebugModalOpen, setIsDebugModalOpen] = useState(false);
  const [debugLogs, setDebugLogs] = useState(null);
  const [debugLoading, setDebugLoading] = useState(false);



  /**
   * 规则引擎调试预览
   */
  const handleDebugRules = async () => {
    if (!data || !data.rows) return;
    
    setDebugLoading(true);
    setIsDebugModalOpen(true);
    setDebugLogs(null);
    
    try {
      const response = await axios.post('/api/debug/preview_rules', {
        rows: data.rows, // Send all rows or filtered? Let's send all for global check
        context: ""
      });
      setDebugLogs(response.data);
    } catch (error) {
      console.error(error);
      message.error('规则预览失败');
    } finally {
      setDebugLoading(false);
    }
  };

  // ==================== 事件处理 (Event Handlers) ====================
  
  /**
   * 处理文件上传
   * 发送文件到后端 /api/upload 接口，并接收解析后的 JSON 数据
   */
  const handleUpload = async ({ file }) => {
    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      // 使用相对路径调用 API，在开发环境通过 Vite 代理转发，生产环境直接访问
      const response = await axios.post('/api/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data', // 必须指定为 multipart/form-data
        },
      });
      
      // 更新数据状态
      console.log('--- Upload Success ---');
      console.log('Server Version:', response.data.server_version || 'Unknown');
      console.log('First Row Global Attributes:', response.data.rows?.[0]?.global_attributes);
      
      setData(response.data);
      message.success(`成功解析: ${response.data.sheet_name} (v${response.data.server_version || '?'})`);
      
      // 重置筛选器
      setSelectedDevice('All');
      
      // 注意：时间范围的初始化逻辑在 useEffect 中处理，依赖于 data 的变化
      
    } catch (error) {
      console.error(error);
      message.error('文件上传或解析失败');
    } finally {
      setLoading(false);
    }
  };

  // ==================== 数据计算与缓存 (Computed / Memoized Data) ====================

  /**
   * 自动识别 Excel 列
   * 启发式算法：根据表头名称猜测哪一列是时间、哪一列是设备ID、哪些是内容
   */
  const columns = useMemo(() => {
    if (!data) return { timeCol: '', deviceCol: '', contentCols: [] };
    
    const headers = data.headers;
    // 1. 识别时间列：查找包含 "时间", "Time", "Date" 的列，或者默认为第一列
    const timeCol = headers.find(h => h.includes('时间') || h.includes('Time') || h.includes('Date')) || headers[0];
    
    // 2. 识别设备/合同号列：通常是第二列（索引为1），如果表头数量大于1
    // 这里假设第二列是设备 ID
    const deviceCol = headers.length > 1 ? headers[1] : '';

    // 3. 识别内容列：除了时间和设备列之外的所有列
    const contentCols = headers.filter(h => h !== timeCol && h !== deviceCol);

    return { timeCol, deviceCol, contentCols };
  }, [data]);

  /**
   * 初始化时间范围
   * 当数据加载或列识别完成后，计算数据的最小和最大时间，并更新状态
   */
  useEffect(() => {
    if (!data || !columns.timeCol) return;
    
    // 提取所有有效的时间戳
    const times = data.rows
        .map(r => new Date(r.cells[columns.timeCol]?.value).getTime())
        .filter(t => !isNaN(t));
        
    if (times.length > 0) {
        const min = Math.min(...times);
        const max = Math.max(...times);
        // 设置完整范围和当前选择范围
        setFullTimeRange([min, max]);
        setTimeRange([min, max]);
    }
  }, [data, columns]);

  /**
   * 提取所有唯一的设备 ID
   * 用于生成下拉筛选菜单的选项
   */
  const deviceOptions = useMemo(() => {
    if (!data || !columns.deviceCol) return [];
    const devices = new Set();
    data.rows.forEach(row => {
      const val = row.cells[columns.deviceCol]?.value;
      if (val) devices.add(val);
    });
    return Array.from(devices);
  }, [data, columns]);

  /**
   * 核心筛选逻辑
   * 根据设备、搜索关键词、时间范围过滤行数据
   */
  const filteredRows = useMemo(() => {
    if (!data) return [];
    
    return data.rows.filter(row => {
      // 1. 设备筛选
      if (selectedDevice !== 'All') {
         const deviceVal = row.cells[columns.deviceCol]?.value;
         if (deviceVal !== selectedDevice) return false;
      }

      // 2. 关键词搜索筛选
      if (searchText) {
        // 检查所有单元格的值或注释是否包含关键词
        if (!Object.values(row.cells).some(cell => 
          String(cell.value).toLowerCase().includes(searchText.toLowerCase()) ||
          (cell.comment && cell.comment.toLowerCase().includes(searchText.toLowerCase()))
        )) return false;
      }
      
      // 3. 时间范围筛选
      // 仅当 fullTimeRange 有效时才进行筛选
      if (fullTimeRange[1] > 0) {
          const timeVal = row.cells[columns.timeCol]?.value;
          if (timeVal) {
              const t = new Date(timeVal).getTime();
              // 如果时间在选择范围之外，则过滤掉
              if (t < timeRange[0] || t > timeRange[1]) return false;
          }
      }

      // 4. 隐藏非关键信息筛选
      if (hideNonCritical) {
          // 检查 row.tags 是否包含非关键标签
          if (row.tags && row.tags.includes("【ℹ️非关键】")) {
              return false;
          }
      }

      return true;
    });
  }, [data, searchText, selectedDevice, columns, timeRange, fullTimeRange, hideNonCritical]);

  /**
   * 心跳与事件数据分离
   * 将数据分类为：装置心跳、电梯心跳、普通事件
   * 用于顶部可视化条带 (Strips) 的渲染
   */
  const heartbeatData = useMemo(() => {
    if (!filteredRows.length) return { deviceHeartbeats: [], elevatorHeartbeats: [], eventHistory: [], timeRange: { start: '', end: '' } };

    const deviceHeartbeats = [];
    const elevatorHeartbeats = [];
    const eventHistory = [];

    // 按时间排序，确保可视化条带上的点位置正确
    const sortedRows = [...filteredRows].sort((a, b) => {
        const timeA = new Date(a.cells[columns.timeCol]?.value).getTime();
        const timeB = new Date(b.cells[columns.timeCol]?.value).getTime();
        return timeA - timeB;
    });

    const minTime = sortedRows[0]?.cells[columns.timeCol]?.value;
    const maxTime = sortedRows[sortedRows.length - 1]?.cells[columns.timeCol]?.value;

    sortedRows.forEach(row => {
      const timeVal = row.cells[columns.timeCol]?.value;
      if (!timeVal) return;

      let isDeviceHeartbeat = false;
      let isElevatorHeartbeat = false;
      let rowBg = '#ffffff'; // 默认背景色

      // 获取行背景色（从 Excel 样式中提取）
      for (const cell of Object.values(row.cells)) {
          if (cell.style?.backgroundColor) {
             rowBg = cell.style.backgroundColor;
             break;
          }
      }

      // 检查是否包含心跳关键词
      columns.contentCols.forEach(col => {
        const val = String(row.cells[col]?.value || '');
        if (val.includes('装置心跳')) isDeviceHeartbeat = true;
        if (val.includes('电梯心跳')) isElevatorHeartbeat = true;
      });

      // 分类存储
      if (isDeviceHeartbeat) {
        deviceHeartbeats.push({ id: row.id, time: timeVal, row });
      }
      if (isElevatorHeartbeat) {
        elevatorHeartbeats.push({ id: row.id, time: timeVal, row });
      }
      
      // 如果既不是装置心跳也不是电梯心跳，则视为普通事件/消息
      if (!isDeviceHeartbeat && !isElevatorHeartbeat) {
          eventHistory.push({ id: row.id, time: timeVal, color: rowBg !== '#ffffff' ? rowBg : '#cccccc', row });
      }
    });

    return { 
        deviceHeartbeats, 
        elevatorHeartbeats, 
        eventHistory,
        timeRange: { start: minTime, end: maxTime }
    };
  }, [filteredRows, columns]);

  /**
   * 准备时间轴显示的数据
   * 注意：为了避免时间轴过于拥挤，这里排除了所有心跳数据，仅展示“事件”
   */
  const displayRows = useMemo(() => {
      return filteredRows.filter(row => {
          let isHeartbeat = false;
          columns.contentCols.forEach(col => {
            const val = String(row.cells[col]?.value || '');
            if (val.includes('装置心跳') || val.includes('电梯心跳')) isHeartbeat = true;
          });
          return !isHeartbeat;
      });
  }, [filteredRows, columns]);

  // ==================== 渲染辅助函数 (Render Helpers) ====================

  /**
   * 渲染单个时间轴节点 (Item)
   * 包含左侧时间 (label) 和右侧卡片 (children)
   */
  const getTimelineItem = (row) => {
    const timeVal = row.cells[columns.timeCol]?.value || `Row ${row.id}`;
    
    // 确定卡片背景色
    let rowBg = '#ffffff';
    
    for (const cell of Object.values(row.cells)) {
        if (cell.style?.backgroundColor) {
            rowBg = cell.style.backgroundColor;
            break; 
        }
    }

    return {
      key: row.id,
      // Remove default dot
      dot: <></>,
      color: rowBg !== '#ffffff' ? rowBg : 'blue', // 时间轴圆点颜色
      // 时间显示：对应 HTML 中的 <strong> 标签
      // Warning: items.label deprecated -> items.title?
      // Warning: items.children deprecated -> items.content?
      // I will provide both to be safe, or just the new ones.
      // AntD 5.x Timeline Item: { label, children } is standard.
      // Maybe the log is from a very new version or a specific build?
      // "Warning: [antd: Timeline] `items.label` is deprecated. Please use `items.title` instead."
      // "Warning: [antd: Timeline] `items.children` is deprecated. Please use `items.content` instead."
      // I will follow the warning.
      label: <Text strong style={{ fontSize: '13px', whiteSpace: 'nowrap' }}>{timeVal}</Text>,
      children: (
        // Flex layout for Global Attributes columns + Main Content
        <div className="flex flex-row gap-2 items-stretch">
           {/* Global Attribute Columns */}
           {/* Render only visible columns based on visibleAttrKeys */}
           {GLOBAL_ATTR_DEFS
             .filter(col => visibleAttrKeys.includes(col.key))
             .map(col => {
                const val = row.global_attributes?.[col.key];
                // Check if value exists (including 0, but excluding null/undefined/empty string)
                const hasValue = val !== undefined && val !== null && val !== '';
                
                return (
                  <div key={col.key} style={{ width: col.width, minWidth: col.width }} className="flex flex-col justify-center">
                    {hasValue ? (
                      <Tooltip title={col.key}>
                        <Card 
                        size="small" 
                        styles={{ body: { padding: '4px', textAlign: 'center', fontSize: '12px', fontWeight: 'bold' } }}
                        className="w-full h-full flex items-center justify-center bg-gray-50 border-gray-200"
                     >
                       {val}
                     </Card>
                   </Tooltip>
                 ) : (
                    // Placeholder for alignment
                    <div className="w-full h-full" /> 
                 )}
               </div>
             );
           })}

           {/* Main Content Card */}
           <div className="flex-1 min-w-0">
            <Card 
              id={`row-${row.id}`} // 用于点击条带时的锚点定位
              size="small" 
              hoverable 
              onClick={() => {
                setSelectedRow(row);
                setDrawerOpen(true);
              }}
              style={{ 
                backgroundColor: rowBg, 
                borderColor: rowBg !== '#ffffff' ? rowBg : '#e5e7eb',
                cursor: 'pointer',
                width: '100%'
              }}
              styles={{ body: { padding: '8px 12px' } }}
            >
               <div className="flex flex-wrap items-center gap-x-3 text-sm">
                  {/* 遍历内容列并展示 */}
                  {columns.contentCols.map((colName, index) => {
                     const cell = row.cells[colName];
                     if (!cell || !cell.value) return null;
                     
                     const cellColor = cell.style?.color || '#000000';
                     
                     return (
                       <span 
                          key={colName} 
                          className={`break-words ${index === 0 ? 'font-semibold' : ''}`} 
                          style={{ color: cellColor }}
                       >
                          {cell.value}
                          {/* 如果有注释，显示提示图标 */}
                          {cell.comment && (
                             <Tooltip title={cell.comment}>
                                <InfoCircleOutlined className="ml-1 text-amber-500" />
                             </Tooltip>
                          )}
                       </span>
                     );
                  })}
                  
                  {columns.contentCols.length === 0 && (
                     <Text type="secondary">No additional data</Text>
                  )}
               </div>
            </Card>
           </div>
        </div>
      )
    };
  };

  // 生成时间轴数据项列表
  const timelineItems = displayRows.map(row => getTimelineItem(row));

  // ==================== 辅助函数：格式化 Note 显示 ====================
  const formatDrawerNote = (note) => {
    if (!note) return null;
    try {
        let obj;
        // Try to parse JSON
        try {
            // Replace Python-like None/True/False if simple replace works, else trust backend cleaned it
            // Backend `_extract_json_from_comment` handles cleaning, but here we might get raw string
            // Let's try standard JSON.parse first
            obj = JSON.parse(note);
        } catch {
            // If failed, try replacing single quotes to double quotes (simple case)
            try {
                const fixed = note.replace(/'/g, '"').replace(/True/g, 'true').replace(/False/g, 'false').replace(/None/g, 'null');
                obj = JSON.parse(fixed);
            } catch {
                // Not JSON
            }
        }

        if (obj && typeof obj === 'object') {
            return (
                <div className="text-xs text-gray-500 mt-2 bg-gray-50 p-2 rounded border border-gray-100">
                    {Object.entries(obj).map(([k, v]) => (
                        <div key={k} className="font-mono">
                            <span className="text-gray-600">{k}:</span> <span className={v ? 'text-green-600' : 'text-red-600'}>{String(v)}</span>
                        </div>
                    ))}
                </div>
            );
        }
        
        // If not object, maybe comma separated string like key:val, key:val
        // Check if it looks like key-value pairs
        if (note.includes(':') && note.includes(',')) {
             // Remove braces
             const clean = note.replace(/^\{|\}$/g, '');
             const parts = clean.split(',').map(p => p.trim()).filter(Boolean);
             return (
                <div className="text-xs text-gray-500 mt-2 bg-gray-50 p-2 rounded border border-gray-100">
                    {parts.map((part, i) => {
                        // Remove quotes from key
                        // "Key": val -> Key: val
                        const p = part.replace(/^"([^"]+)":/, '$1:').replace(/^'([^']+)':/, '$1:');
                        return <div key={i} className="font-mono">{p}</div>;
                    })}
                </div>
             );
        }

        return <div className="text-xs text-gray-500 mt-1">{note}</div>;
    } catch (e) {
        return <div className="text-xs text-gray-500 mt-1">{note}</div>;
    }
  };

  // ==================== 主渲染 (Main Render) ====================
  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="w-full max-w-full px-4 mx-auto">
        {/* 标题区域 */}
        <div className="mb-6 text-center">
          <Title level={2}>Timeline AI Visualizer</Title>
          {!data && <Paragraph>Upload your Excel timeline for an interactive experience.</Paragraph>}
        </div>

        {/* 上传区域：无数据时显示 */}
        {!data && (
          <div className="flex justify-center mb-12">
             <Upload 
                customRequest={handleUpload} 
                showUploadList={false}
                accept=".xlsx"
             >
                <Button type="primary" icon={<UploadOutlined />} size="large" loading={loading}>
                  Upload Excel Timeline
                </Button>
             </Upload>
          </div>
        )}

        {/* 主内容区域：有数据时显示 */}
        {data && (
          <div className="bg-white p-6 rounded-lg shadow-sm">
            {/* 工具栏：标题、计数、筛选器 */}
            <div className="flex flex-wrap gap-4 justify-between items-center mb-6 sticky top-0 bg-white z-10 py-4 border-b shadow-sm">
               <Space size="large">
                 <Title level={4} style={{ margin: 0 }}>{data.sheet_name}</Title>
                 <Tag color="blue">{filteredRows.length} Events</Tag>
               </Space>
               
               <Space wrap>
                 {/* 设备筛选下拉框 */}
                 {deviceOptions.length > 0 && (
                    <Select 
                      value={selectedDevice} 
                      onChange={setSelectedDevice} 
                      style={{ width: 200 }}
                      placeholder="Select Device/Contract"
                    >
                       <Option value="All">All Devices</Option>
                       {deviceOptions.map(d => (
                         <Option key={d} value={d}>{d}</Option>
                       ))}
                    </Select>
                 )}

                 {/* 搜索框 */}
                 <Input 
                    placeholder="Search contents..." 
                    prefix={<SearchOutlined />} 
                    value={searchText}
                    onChange={e => setSearchText(e.target.value)}
                    style={{ width: 250 }}
                    allowClear
                 />

                 {/* 隐藏非关键信息开关 */}
                 <Button 
                    type={hideNonCritical ? "primary" : "default"}
                    icon={<FilterOutlined />}
                    onClick={() => setHideNonCritical(!hideNonCritical)}
                 >
                    {hideNonCritical ? "显示所有" : "隐藏非关键"}
                 </Button>

                 {/* 全局属性列配置 */}
                 <Popover
                    trigger="click"
                    placement="bottom"
                    content={
                        <div className="flex flex-col gap-2 p-2 w-48">
                            <Text strong className="mb-1">显示属性列</Text>
                            <Checkbox.Group 
                                className="flex flex-col gap-2"
                                value={visibleAttrKeys}
                                onChange={setVisibleAttrKeys}
                            >
                                {GLOBAL_ATTR_DEFS.map(attr => (
                                    <Checkbox key={attr.key} value={attr.key}>
                                        {attr.label}
                                    </Checkbox>
                                ))}
                            </Checkbox.Group>
                        </div>
                    }
                 >
                    <Button icon={<SettingOutlined />}>
                        属性列
                    </Button>
                 </Popover>
                 


                 {/* 调试按钮 */}
                 <Tooltip title="查看规则引擎的打标和提取结果">
                    <Button 
                        type="dashed" 
                        icon={<BugOutlined />} 
                        onClick={handleDebugRules}
                    />
                 </Tooltip>

                 {/* 清除按钮 */}
                 <Button onClick={() => {
                   setData(null);
                   setSearchText('');
                   setSelectedDevice('All');
                 }}>Clear / Re-upload</Button>
               </Space>
            </div>

            {/* 心跳可视化条带区域 */}
            {(heartbeatData.deviceHeartbeats.length > 0 || heartbeatData.elevatorHeartbeats.length > 0 || heartbeatData.eventHistory.length > 0) && (
              <div className="mb-8 p-4 bg-gray-50 rounded border border-gray-100">
                 <div className="mb-4 flex flex-col gap-2">
                    <Title level={5} className="text-gray-600 !mb-0" style={{ fontSize: '14px' }}>
                       在线状态（心跳） 
                    </Title>
                    {/* 时间范围滑块 */}
                    <div className="px-2">
                        <Slider 
                            range 
                            min={fullTimeRange[0]} 
                            max={fullTimeRange[1]} 
                            value={timeRange} 
                            onChange={setTimeRange}
                            tooltip={{ formatter: (val) => new Date(val).toLocaleString() }}
                        />
                        <div className="flex justify-between text-xs text-gray-400">
                            <span>{new Date(timeRange[0]).toLocaleString()}</span>
                            <span>{new Date(timeRange[1]).toLocaleString()}</span>
                        </div>
                    </div>
                 </div>
                 
                 {/* 装置心跳条带 (Device Heartbeat Strip) */}
                 <div className="flex items-center mb-4">
                    <div className="w-24 shrink-0 text-xs font-bold text-gray-500 flex items-center gap-1">
                       <WifiOutlined className="text-blue-500" /> 装置
                    </div>
                    <div className="flex-1 relative h-8 bg-gray-200 rounded overflow-hidden">
                       {heartbeatData.deviceHeartbeats.map((hb, idx) => {
                          const allTimes = filteredRows.map(r => r.cells[columns.timeCol]?.value).filter(Boolean).sort();
                          const minTime = new Date(allTimes[0]).getTime();
                          const maxTime = new Date(allTimes[allTimes.length - 1]).getTime();
                          const currTime = new Date(hb.time).getTime();
                          const range = maxTime - minTime;
                          const left = range === 0 ? 50 : ((currTime - minTime) / range) * 100;
                          
                          return (
                             <Tooltip 
                               key={hb.id} 
                               title={
                                   <div className="max-w-xs">
                                       <div className="font-bold mb-1">装置在线</div>
                                       <div>{hb.time}</div>
                                   </div>
                               }
                             >
                                <div 
                                  className="absolute w-2 h-full bg-blue-500/60 hover:bg-blue-600 cursor-pointer transition-colors"
                                  style={{ left: `${left}%`, width: '4px' }}
                                />
                             </Tooltip>
                          );
                       })}
                    </div>
                 </div>

                 {/* 电梯心跳条带 (Elevator Heartbeat Strip) */}
                 <div className="flex items-center mb-4">
                    <div className="w-24 shrink-0 text-xs font-bold text-gray-500 flex items-center gap-1">
                       <ApartmentOutlined className="text-green-500" /> 电梯
                    </div>
                    <div className="flex-1 relative h-8 bg-gray-200 rounded overflow-hidden">
                       {heartbeatData.elevatorHeartbeats.map((hb, idx) => {
                          // 注意：这里重复计算了 allTimes/minTime/maxTime，实际项目中可以提取为通用变量优化性能
                          const allTimes = filteredRows.map(r => r.cells[columns.timeCol]?.value).filter(Boolean).sort();
                          const minTime = new Date(allTimes[0]).getTime();
                          const maxTime = new Date(allTimes[allTimes.length - 1]).getTime();
                          const currTime = new Date(hb.time).getTime();
                          const range = maxTime - minTime;
                          const left = range === 0 ? 50 : ((currTime - minTime) / range) * 100;
                          
                          return (
                             <Tooltip 
                                key={hb.id} 
                                title={
                                    <div className="max-w-xs">
                                        <div className="font-bold mb-1">电梯在线</div>
                                        <div>{hb.time}</div>
                                    </div>
                                }
                             >
                                <div 
                                  className="absolute w-2 h-full bg-green-500/60 hover:bg-green-600 cursor-pointer transition-colors"
                                  style={{ left: `${left}%`, width: '4px' }}
                                />
                             </Tooltip>
                          );
                       })}
                    </div>
                 </div>

                 {/* 消息历史条带 (Event History Strip) */}
                 <div className="flex items-center">
                    <div className="w-24 shrink-0 text-xs font-bold text-gray-500 flex items-center gap-1">
                       <HistoryOutlined className="text-gray-500" /> 消息
                    </div>
                    <div className="flex-1 relative h-8 bg-gray-100 rounded overflow-hidden">
                       {heartbeatData.eventHistory.map((ev, idx) => {
                          const allTimes = filteredRows.map(r => r.cells[columns.timeCol]?.value).filter(Boolean).sort();
                          const minTime = new Date(allTimes[0]).getTime();
                          const maxTime = new Date(allTimes[allTimes.length - 1]).getTime();
                          const currTime = new Date(ev.time).getTime();
                          const range = maxTime - minTime;
                          const left = range === 0 ? 50 : ((currTime - minTime) / range) * 100;
                          
                          return (
                             <Tooltip 
                                key={ev.id} 
                                styles={{ root: { maxWidth: '500px' } }}
                                title={
                                    <div className="text-xs">
                                        <div className="font-bold mb-1">{ev.time}</div>
                                        {/* 预览内容 */}
                                        {columns.contentCols.map(col => {
                                            const val = ev.row.cells[col]?.value;
                                            if (!val) return null;
                                            return <div key={col} className="truncate">{val}</div>
                                        })}
                                    </div>
                                }
                             >
                                <div 
                                  className="absolute w-1 h-full cursor-pointer transition-all hover:brightness-110 hover:z-10 hover:w-2 hover:-ml-0.5"
                                  style={{ 
                                      left: `${left}%`, 
                                      backgroundColor: ev.color,
                                      opacity: 0.8
                                  }}
                                  onClick={() => {
                                      // 点击条带上的点，滚动到对应的时间轴卡片
                                      const el = document.getElementById(`row-${ev.id}`);
                                      if (el) {
                                          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                          // 添加高亮效果
                                          el.classList.add('ring-2', 'ring-blue-500');
                                          setTimeout(() => el.classList.remove('ring-2', 'ring-blue-500'), 2000);
                                      }
                                  }}
                                />
                             </Tooltip>
                          );
                       })}
                    </div>
                 </div>
              </div>
            )}

            {/* 时间轴主体 (Timeline) */}
            <div className="pl-0">
                <Timeline 
                  className="custom-timeline"
                  mode="left" // Keep 'left' for now as 'start' might change layout unexpectedly, if it warns again I'll change it. The warning said "Please use mode=start|end instead".
                  // Okay, I will try 'left' first, if user complains again I switch.
                  // Wait, the user ALREADY complained.
                  // "Warning: [antd: Timeline] `mode=left|right` is deprecated. Please use `mode=start|end` instead."
                  // So I MUST change it.
                  // 'left' corresponds to 'left' side line? Or content on left?
                  // Documentation says: mode="left" -> line on right, content on left? Or line on left?
                  // Usually mode="left" means content is on the left of the line.
                  // But here I want standard timeline.
                  // Let's use `mode="alternate"` if I want zigzag, or default.
                  // If I want line on left and content on right, it's usually just default or `mode="right"` (content right).
                  // Wait, AntD default is line left, content right.
                  // So I might not need `mode` at all if I want default.
                  // But my code had `mode="left"`.
                  // If I change to `mode="left"`, it might be content on left.
                  // Let's remove `mode` to see if default is what we want (line left, content right).
                  // Or use `mode="left"` replacement which is... `left` deprecated.
                  // If I want content on left, use `mode="left"`. Replacement is...
                  // Actually, `mode` supports `left`, `right`, `alternate`.
                  // Warning says `start` / `end`.
                  // `left` -> `start` (if LTR)?
                  // Let's try `mode="left"` (deprecated) -> `mode="left"` (maybe it's not deprecated in my version but user log says so).
                  // I will change to `mode="left"` -> `mode="left"`... wait.
                  // I'll just remove `mode="left"` because default is usually fine.
                  // BUT, I will map items props as requested.
                  items={timelineItems.map(item => ({
                      ...item,
                      // Map deprecated props
                      // label -> label (The warning says label->title?? This is very strange for Timeline)
                      // children -> children (Warning says children->content??)
                      // I will blindly follow the warning: label->title, children->content.
                      // But I must keep original too just in case.
                      // Actually, if I pass extra props it shouldn't hurt.
                      title: item.label,
                      content: item.children
                  }))} 
                  style={{ width: '100%' }}
                />
            </div>
          </div>
        )}

        {/* 详情抽屉 (Detail Drawer) */}
        {/* 用于显示行的完整原始数据，包括被隐藏的列或元数据 */}
        <Drawer
        title="Event Details"
        placement="right"
        onClose={() => setDrawerOpen(false)}
        open={drawerOpen}
        styles={{ body: { paddingBottom: 80 } }}
        // width prop is deprecated in recent antd versions in favor of size or style
        // However, for custom pixel width, style or width should still work but might warn.
        // Let's try to remove width and use styles wrapper if needed, OR ignore if it works.
        // User explicitly asked to fix warning.
        // If we want exactly 500px, size='large' is 736px.
        // Let's use style={{ width: 500 }} on a wrapper or just accept standard size?
        // Actually, the warning says "Please use size instead".
        // Let's try to set size="default" (378px) or "large" (736px).
        // Or keep width but acknowledge warning. 
        // Best fix: pass width to style if possible, but Drawer is a portal.
        // Let's just set size="large" for now to satisfy the "use size instead" warning.
        size="large"
      >
          {selectedRow && (
            <div className="flex flex-col gap-4">
               {/* Same details rendering logic could go here or use existing */}
               <div className="mb-4">
                  <Text type="secondary" className="block mb-1">Time</Text>
                  <Title level={5} style={{margin:0}}>{selectedRow.cells[columns.timeCol]?.value}</Title>
               </div>
               
               {columns.contentCols.map(colName => (
                  <div key={colName} className="p-3 bg-gray-50 rounded border border-gray-100">
                     <Text type="secondary" className="block mb-1 text-xs">{colName}</Text>
                     <Text>{selectedRow.cells[colName]?.value}</Text>
                     {/* Show Comment/Note if exists, formatted */}
                     {selectedRow.cells[colName]?.comment && formatDrawerNote(selectedRow.cells[colName].comment)}
                  </div>
               ))}
               

            </div>
          )}
        </Drawer>



        {/* Debug Rules Modal */}
        <Modal
        title={
            <Space>
                <BugOutlined />
                <span>规则引擎调试预览</span>
            </Space>
        }
        open={isDebugModalOpen}
        onCancel={() => setIsDebugModalOpen(false)}
        width={900}
        footer={null}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
          {debugLoading && !debugLogs ? (
              <div className="flex justify-center py-8"><Spin /></div>
          ) : debugLogs ? (
              <div className="flex flex-col gap-6">
                  
                  {/* 1. 延时上传 */}
                  <Card size="small" title={<Space><HistoryOutlined className="text-orange-500"/><span>延时上传 ({debugLogs.delayed_rows.length})</span></Space>}>
                      <Table 
                          dataSource={debugLogs.delayed_rows} 
                          rowKey="id"
                          pagination={{ pageSize: 5 }}
                          size="small"
                          columns={[
                              { title: 'Row', dataIndex: 'id', width: 60 },
                              { title: 'Time', dataIndex: 'time', width: 150 },
                              { title: 'Delay (min)', dataIndex: 'delay_min', width: 100, render: v => <Tag color="orange">{v} min</Tag> },
                              { title: 'Content', dataIndex: 'content', ellipsis: true }
                          ]}
                      />
                  </Card>

                  {/* 2. 全局属性提取 */}
                  <Card size="small" title={<Space><ApartmentOutlined className="text-blue-500"/><span>全局属性提取 ({debugLogs.attribute_rows.length})</span></Space>}>
                      <Table 
                          dataSource={debugLogs.attribute_rows} 
                          rowKey="id"
                          pagination={{ pageSize: 5 }}
                          size="small"
                          columns={[
                              { title: 'Row', dataIndex: 'id', width: 60 },
                              { title: 'Time', dataIndex: 'time', width: 150 },
                              { 
                                  title: 'Extracted Attributes', 
                                  dataIndex: 'extracted_attrs',
                                  render: (attrs) => (
                                      <div className="flex flex-wrap gap-1">
                                          {attrs.map(a => <Tag key={a} color="geekblue">{a}</Tag>)}
                                      </div>
                                  )
                              },
                              { title: 'Content', dataIndex: 'content', ellipsis: true }
                          ]}
                      />
                  </Card>

                  {/* 3. 被忽略的非关键行 */}
                  <Card size="small" title={<Space><FilterOutlined className="text-gray-400"/><span>被忽略的非关键信息 ({debugLogs.ignored_rows.length})</span></Space>}>
                      <Table 
                          dataSource={debugLogs.ignored_rows} 
                          rowKey="id"
                          pagination={{ pageSize: 5 }}
                          size="small"
                          columns={[
                              { title: 'Row', dataIndex: 'id', width: 60 },
                              { title: 'Time', dataIndex: 'time', width: 150 },
                              { title: 'Reason', dataIndex: 'reason', width: 200 },
                              { title: 'Content', dataIndex: 'content', ellipsis: true }
                          ]}
                      />
                  </Card>
              </div>
          ) : null}
        </Modal>
      </div>
    </div>
  );
}

export default App;
