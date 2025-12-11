import { useState, useMemo, useEffect } from 'react';
import axios from 'axios';
import { Upload, Button, Timeline, Card, Tag, Typography, Input, message, Drawer, Space, Tooltip, Select, Row, Col, Slider } from 'antd';
import { UploadOutlined, SearchOutlined, FilterOutlined, InfoCircleOutlined, WifiOutlined, ApartmentOutlined, HistoryOutlined } from '@ant-design/icons';
import './index.css';

const { Title, Text, Paragraph } = Typography;
const { Search } = Input;
const { Option } = Select;

function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedRow, setSelectedRow] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState('All');
  const [timeRange, setTimeRange] = useState([0, 0]);
  const [fullTimeRange, setFullTimeRange] = useState([0, 0]);

  // Upload handler
  const handleUpload = async ({ file }) => {
    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      // In development, we need to point to the backend port
      const response = await axios.post('http://localhost:8000/api/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      setData(response.data);
      message.success(`成功解析: ${response.data.sheet_name}`);
      // Reset filters
      setSelectedDevice('All');
      
      // Initialize Time Range
      if (response.data.rows && response.data.rows.length > 0) {
        // We need to find the time column again, or just re-calculate later. 
        // But to set initial state, we'll do a quick pass or rely on useEffect.
        // Let's rely on a useEffect or immediate calculation here if we can extract columns.
        // Actually, let's wait for columns to be identified by useMemo, 
        // but we can't easily sync state in render. 
        // So we will parse times here roughly or just let the user adjust.
        // BETTER: Set a flag or use useEffect to update timeRange when data changes.
      }
    } catch (error) {
      console.error(error);
      message.error('文件上传或解析失败');
    } finally {
      setLoading(false);
    }
  };

  // Identify columns
  const columns = useMemo(() => {
    if (!data) return { timeCol: '', deviceCol: '', contentCols: [] };
    
    const headers = data.headers;
    // 1. Time Column: Look for "时间", "Time", "Date" or first column
    const timeCol = headers.find(h => h.includes('时间') || h.includes('Time') || h.includes('Date')) || headers[0];
    
    // 2. Device/Contract Column: Usually the 2nd column if it contains alphanumeric codes like "23N..."
    // We'll heuristically assume the 2nd column (index 1) is the device ID if headers length > 1
    const deviceCol = headers.length > 1 ? headers[1] : '';

    // 3. Content Columns: All others
    const contentCols = headers.filter(h => h !== timeCol && h !== deviceCol);

    return { timeCol, deviceCol, contentCols };
  }, [data]);

  // Update time range when data loads
  useEffect(() => {
    if (!data || !columns.timeCol) return;
    
    const times = data.rows
        .map(r => new Date(r.cells[columns.timeCol]?.value).getTime())
        .filter(t => !isNaN(t));
        
    if (times.length > 0) {
        const min = Math.min(...times);
        const max = Math.max(...times);
        // Add a small buffer or just use exact
        setFullTimeRange([min, max]);
        setTimeRange([min, max]);
    }
  }, [data, columns]);

  // Extract unique devices for filter
  const deviceOptions = useMemo(() => {
    if (!data || !columns.deviceCol) return [];
    const devices = new Set();
    data.rows.forEach(row => {
      const val = row.cells[columns.deviceCol]?.value;
      if (val) devices.add(val);
    });
    return Array.from(devices);
  }, [data, columns]);

  // Filter data
  const filteredRows = useMemo(() => {
    if (!data) return [];
    
    return data.rows.filter(row => {
      // 1. Device Filter
      if (selectedDevice !== 'All') {
         const deviceVal = row.cells[columns.deviceCol]?.value;
         if (deviceVal !== selectedDevice) return false;
      }

      // 2. Search Filter
      if (searchText) {
        if (!Object.values(row.cells).some(cell => 
          String(cell.value).toLowerCase().includes(searchText.toLowerCase()) ||
          (cell.comment && cell.comment.toLowerCase().includes(searchText.toLowerCase()))
        )) return false;
      }
      
      // 3. Time Range Filter
      // Only filter if fullTimeRange is set and valid
      if (fullTimeRange[1] > 0) {
          const timeVal = row.cells[columns.timeCol]?.value;
          if (timeVal) {
              const t = new Date(timeVal).getTime();
              if (t < timeRange[0] || t > timeRange[1]) return false;
          }
      }

      return true;
    });
  }, [data, searchText, selectedDevice, columns, timeRange, fullTimeRange]);

  // Extract heartbeat data
  const heartbeatData = useMemo(() => {
    if (!filteredRows.length) return { deviceHeartbeats: [], elevatorHeartbeats: [], eventHistory: [], timeRange: { start: '', end: '' } };

    const deviceHeartbeats = [];
    const elevatorHeartbeats = [];
    const eventHistory = [];

    // Sort rows by time to ensure correct range
    const sortedRows = [...filteredRows].sort((a, b) => {
        const timeA = new Date(a.cells[columns.timeCol]?.value).getTime();
        const timeB = new Date(b.cells[columns.timeCol]?.value).getTime();
        return timeA - timeB;
    });

    const minTime = sortedRows[0]?.cells[columns.timeCol]?.value;
    const maxTime = sortedRows[sortedRows.length - 1]?.cells[columns.timeCol]?.value;

    sortedRows.forEach(row => {
      // Find time
      const timeVal = row.cells[columns.timeCol]?.value;
      if (!timeVal) return;

      // Check content for heartbeat keywords
      let isDeviceHeartbeat = false;
      let isElevatorHeartbeat = false;
      let rowColor = '#000000';
      let rowBg = '#ffffff';

      // Determine colors
      for (const cell of Object.values(row.cells)) {
          if (cell.style?.backgroundColor) {
             rowBg = cell.style.backgroundColor;
             break;
          }
      }

      columns.contentCols.forEach(col => {
        const val = String(row.cells[col]?.value || '');
        if (val.includes('装置心跳')) isDeviceHeartbeat = true;
        if (val.includes('电梯心跳')) isElevatorHeartbeat = true;
      });

      if (isDeviceHeartbeat) {
        deviceHeartbeats.push({ id: row.id, time: timeVal, row });
      }
      if (isElevatorHeartbeat) {
        elevatorHeartbeats.push({ id: row.id, time: timeVal, row });
      }
      
      // For event history, include everything (or maybe exclude heartbeats if desired, 
      // but user said "various messages... e.g. orange elevator exception", implies showing important stuff.
      // Let's include everything that is NOT a heartbeat for clarity, or EVERYTHING?
      // "inside div... add a strip... showing various messages... e.g. orange elevator exception"
      // Usually heartbeats are noise in the event strip if they are already above.
      // Let's exclude heartbeats from the 3rd strip to highlight "events".
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

  // Timeline items should EXCLUDE heartbeats now as requested
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

  // Render a single timeline item
  const getTimelineItem = (row) => {
    const timeVal = row.cells[columns.timeCol]?.value || `Row ${row.id}`;
    
    // Determine card style based on row color
    let rowBg = '#ffffff';
    let rowColor = '#000000';
    
    for (const cell of Object.values(row.cells)) {
        if (cell.style?.backgroundColor) {
            rowBg = cell.style.backgroundColor;
            break; 
        }
    }

    const hasComments = Object.values(row.cells).some(c => c.comment);

    return {
      key: row.id,
      color: rowBg !== '#ffffff' ? rowBg : 'blue',
      label: <Text strong style={{ fontSize: '13px', whiteSpace: 'nowrap' }}>{timeVal}</Text>,
      children: (
        <Card 
          id={`row-${row.id}`}
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
              {/* Display all content columns directly without labels */}
              {columns.contentCols.map((colName, index) => {
                 const cell = row.cells[colName];
                 if (!cell || !cell.value) return null;
                 
                 // Use cell specific color if available, otherwise default black
                 const cellColor = cell.style?.color || '#000000';
                 
                 return (
                   <span 
                      key={colName} 
                      className={`break-words ${index === 0 ? 'font-semibold' : ''}`} 
                      style={{ color: cellColor }}
                   >
                      {cell.value}
                      {cell.comment && (
                         <Tooltip title={cell.comment}>
                            <InfoCircleOutlined className="ml-1 text-amber-500" />
                         </Tooltip>
                      )}
                   </span>
                 );
              })}
              
              {/* Fallback if no content columns found (shouldn't happen usually) */}
              {columns.contentCols.length === 0 && (
                 <Text type="secondary">No additional data</Text>
              )}
           </div>
        </Card>
      )
    };
  };

  const timelineItems = displayRows.map(row => getTimelineItem(row));

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="w-full max-w-full px-4 mx-auto">
        <div className="mb-6 text-center">
          <Title level={2}>Timeline AI Visualizer</Title>
          {!data && <Paragraph>Upload your Excel timeline for an interactive experience.</Paragraph>}
        </div>

        {/* Upload Area */}
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

        {/* Main Content */}
        {data && (
          <div className="bg-white p-6 rounded-lg shadow-sm">
            {/* Toolbar */}
            <div className="flex flex-wrap gap-4 justify-between items-center mb-6 sticky top-0 bg-white z-10 py-4 border-b shadow-sm">
               <Space size="large">
                 <Title level={4} style={{ margin: 0 }}>{data.sheet_name}</Title>
                 <Tag color="blue">{filteredRows.length} Events</Tag>
               </Space>
               
               <Space wrap>
                 {/* Device Filter */}
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

                 <Input 
                    placeholder="Search contents..." 
                    prefix={<SearchOutlined />} 
                    value={searchText}
                    onChange={e => setSearchText(e.target.value)}
                    style={{ width: 250 }}
                    allowClear
                 />
                 <Button onClick={() => {
                   setData(null);
                   setSearchText('');
                   setSelectedDevice('All');
                 }}>Clear / Re-upload</Button>
               </Space>
            </div>

            {/* Heartbeat Visualization */}
            {(heartbeatData.deviceHeartbeats.length > 0 || heartbeatData.elevatorHeartbeats.length > 0 || heartbeatData.eventHistory.length > 0) && (
              <div className="mb-8 p-4 bg-gray-50 rounded border border-gray-100">
                 <div className="mb-4 flex flex-col gap-2">
                    <Title level={5} className="text-gray-600 !mb-0" style={{ fontSize: '14px' }}>
                       在线状态（心跳） 
                    </Title>
                    {/* Time Range Slider */}
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
                 
                 {/* Device Heartbeat Strip */}
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

                 {/* Elevator Heartbeat Strip */}
                 <div className="flex items-center mb-4">
                    <div className="w-24 shrink-0 text-xs font-bold text-gray-500 flex items-center gap-1">
                       <ApartmentOutlined className="text-green-500" /> 电梯
                    </div>
                    <div className="flex-1 relative h-8 bg-gray-200 rounded overflow-hidden">
                       {heartbeatData.elevatorHeartbeats.map((hb, idx) => {
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

                 {/* Event History Strip */}
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
                                        {/* Show content preview */}
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
                                      // Scroll to item
                                      const el = document.getElementById(`row-${ev.id}`);
                                      if (el) {
                                          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                          // Highlight effect
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

            {/* Timeline */}
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

        {/* Detail Drawer (Still kept for extra deep inspection if needed) */}
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
