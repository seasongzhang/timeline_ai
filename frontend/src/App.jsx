import { useState, useMemo, useEffect } from 'react'; // React 核心 Hooks：状态管理、计算缓存、副作用处理
import axios from 'axios'; // HTTP 客户端：用于向后端发送请求
// Ant Design UI 组件库：提供现成的界面元素
import { Upload, Button, Timeline, Card, Tag, Typography, Input, message, Drawer, Space, Tooltip, Select, Row, Col, Slider } from 'antd';
// Ant Design 图标库：提供界面所需的各种图标
import { UploadOutlined, SearchOutlined, FilterOutlined, InfoCircleOutlined, WifiOutlined, ApartmentOutlined, HistoryOutlined } from '@ant-design/icons';
import { Analytics } from "@vercel/analytics/next"
import './index.css'; // 全局样式文件

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
      setData(response.data);
      message.success(`成功解析: ${response.data.sheet_name}`);
      
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

      return true;
    });
  }, [data, searchText, selectedDevice, columns, timeRange, fullTimeRange]);

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
      color: rowBg !== '#ffffff' ? rowBg : 'blue', // 时间轴圆点颜色
      // 时间显示：对应 HTML 中的 <strong> 标签
      label: <Text strong style={{ fontSize: '13px', whiteSpace: 'nowrap' }}>{timeVal}</Text>,
      children: (
        // 内容卡片：对应 HTML 中的 div.ant-timeline-item-content
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
          bodyStyle={{ padding: '8px 12px' }}
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
      )
    };
  };

  // 生成时间轴数据项列表
  const timelineItems = displayRows.map(row => getTimelineItem(row));

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
                                overlayStyle={{ maxWidth: '500px' }}
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
                  mode="left" 
                  items={timelineItems} 
                  style={{ width: '100%' }}
                />
            </div>
          </div>
        )}

        {/* 详情抽屉 (Detail Drawer) */}
        {/* 用于显示行的完整原始数据，包括被隐藏的列或元数据 */}
        <Drawer
          title={`Event Details (Row ${selectedRow?.id})`}
          placement="right"
          size="large"
          onClose={() => setDrawerOpen(false)}
          open={drawerOpen}
        >
          {selectedRow && (
            <div className="space-y-4">
               {data.headers.map(header => {
                   const cell = selectedRow.cells[header];
                   if (!cell || !cell.value) return null;
                   
                   return (
                       <div key={header} className="border-b pb-2">
                           <Text type="secondary" className="text-xs uppercase">{header}</Text>
                           <div 
                              className="mt-1 p-2 rounded"
                              style={{ 
                                  backgroundColor: cell.style?.backgroundColor || 'transparent',
                                  color: cell.style?.color || 'inherit'
                              }}
                           >
                               <Text>{cell.value}</Text>
                           </div>
                           {cell.comment && (
                               <div className="mt-1 bg-yellow-50 p-2 border-l-4 border-yellow-400 text-xs text-gray-600">
                                   <strong>Note:</strong> {cell.comment}
                               </div>
                           )}
                       </div>
                   )
               })}
            </div>
          )}
        </Drawer>
      </div>
    </div>
  );
}

export default App;
