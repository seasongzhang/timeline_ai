from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import openpyxl
import io
from typing import List, Dict, Any, Union
import os
from openai import OpenAI
from pydantic import BaseModel

app = FastAPI()

# Initialize OpenAI Client (Ensure OPENAI_API_KEY is set in environment)
client = OpenAI(
    api_key=os.environ.get("OPENAI_API_KEY", "sk-placeholder"),
    base_url=os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
)

class AnalysisRequest(BaseModel):
    rows: List[Dict]
    context: str = ""

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify the frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_rgb_color(color_obj):
    if not color_obj:
        return None
    if color_obj.type == 'rgb':
        # Some rgb values are 8 chars (AARRGGBB), we need RRGGBB
        rgb = color_obj.rgb
        if len(rgb) == 8:
            return '#' + rgb[2:]
        return '#' + rgb
    # Handle theme colors if needed, skipping for now as it's complex without theme xml
    return None

import re
import json
from datetime import datetime

class TimelinePreprocessor:
    """
    Implements domain-specific logic to clean, filter, and enrich timeline data
    before sending it to the LLM.
    """
    
    # Configuration for Tagging System
    TAG_CONFIG = {
        "non_critical": {
            "keywords": [
                "391(管理综合故障)",
                "7C8(前门门机警告类综合故障)",
            ],
            "regex": [
                # r"故障代码.*\(无关\)" # Example regex
            ]
        },
        "delayed_upload": {
            "threshold_minutes": 10
        }
    }

    # Configuration for Global Attribute Extraction
    # Format: { AttributeName: [ { keys: [k1, k2], value_map: {val_in_json: normalized_val} } ] }
    GLOBAL_ATTR_CONFIG = {
        "控制同步层": [
            {
                "keys": ["控制同步层"], # Try these keys in order
                "value_map": None, # Direct value
                "transform": lambda x: int(x) + 1 if str(x).isdigit() else x # Transform +1 for floor
            }
        ],
        "41DG信号": [
            # Case 1: 故障诊断履历
            {
                "keys": ["41DG信号"],
                "value_map": {
                    "闭合": "闭合",
                    "断开": "断开"
                }
            },
            # Case 2: 运行模式 / 检修开关履历
            {
                "keys": ["门锁状态（41DG）"],
                "value_map": {
                    "门锁断开(41DG_OFF)": "断开",
                    "门锁闭合(41DG_ON)": "闭合", # Assuming opposite exists
                    "闭合": "闭合"
                }
            }
        ]
    }

    def __init__(self):
        self.last_fault_time = 0
        self.last_fault_code = None

    def _is_purple_color(self, hex_color: str) -> bool:
        if not hex_color:
            return False
        hex_color = hex_color.upper().replace('#', '')
        if len(hex_color) != 6:
            return False
        try:
            r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
            return r > 100 and b > 100 and g < 100
        except:
            return False

    def _extract_json_from_comment(self, comment: str) -> Dict:
        """
        Robustly extract JSON-like structure from comment string.
        Handles: Note: {...} or just {...} or Python dict string representation.
        """
        if not comment:
            return {}
        
        # Try to find { ... } block
        match = re.search(r'(\{.*\})', comment, re.DOTALL)
        if not match:
            return {}
        
        json_str = match.group(1)
        try:
            # Try standard JSON
            return json.loads(json_str)
        except:
            try:
                # Try replacing single quotes with double quotes (Python dict str)
                # Handle boolean values
                fixed_str = json_str.replace("'", '"')\
                                    .replace("True", "true")\
                                    .replace("False", "false")\
                                    .replace("None", "null")
                return json.loads(fixed_str)
            except:
                return {}

    def _get_value_from_cells(self, row: Dict, key_substr: str) -> str:
        """Helper to find value in cells where column name contains key_substr"""
        for col_name, cell_data in row.get("cells", {}).items():
            if key_substr in col_name:
                return str(cell_data.get("value", ""))
        return ""

    def _get_comment_from_cells(self, row: Dict) -> str:
        """Combine comments from all cells"""
        comments = []
        for cell_data in row.get("cells", {}).values():
            c = cell_data.get("comment")
            if c:
                comments.append(c)
        return "\n".join(comments)

    def _parse_timestamp(self, time_str: str) -> datetime:
        """Parse timestamp string to datetime object."""
        if not time_str:
            return None
        # Try common formats
        formats = [
            "%Y-%m-%d %H:%M:%S",
            "%Y/%m/%d %H:%M:%S",
            "%H:%M:%S" # If no date, might need context, but for diff check ok?
        ]
        for fmt in formats:
            try:
                # If only time, assume today or handle gracefully? 
                # For 10 min diff check, we need full datetime usually.
                # If input has only time, we might fail comparison if date differs.
                # Assuming input string has Date if "装置时间" has Date.
                return datetime.strptime(time_str, fmt)
            except ValueError:
                continue
        return None

    def _extract_attributes(self, row: Dict) -> Dict[str, Any]:
        """
        Extract global attributes from a single row.
        """
        extracted = {}
        # Extract Note JSON
        note_str = self._get_comment_from_cells(row)
        note_json = self._extract_json_from_comment(note_str)
        
        if note_json:
            for attr_name, rules in self.GLOBAL_ATTR_CONFIG.items():
                found_val = None
                
                for rule in rules:
                    # Try to find any key from rule['keys'] in note_json
                    for k in rule['keys']:
                        if k in note_json:
                            raw_val = note_json[k]
                            
                            # Apply Value Mapping if exists
                            if rule.get('value_map'):
                                # Try exact match first
                                if raw_val in rule['value_map']:
                                    found_val = rule['value_map'][raw_val]
                                # Try string match
                                elif str(raw_val) in rule['value_map']:
                                    found_val = rule['value_map'][str(raw_val)]
                                else:
                                    # Fallback: keep raw if not mapped? Or None?
                                    # User wants specific mapping. If not mapped, maybe keep raw.
                                    found_val = raw_val
                            else:
                                found_val = raw_val
                                
                            # Apply Transformation if exists
                            if rule.get('transform') and found_val is not None:
                                try:
                                    found_val = rule['transform'](found_val)
                                except:
                                    pass
                            
                            if found_val is not None:
                                break # Found a valid key for this rule
                    
                    if found_val is not None:
                        break # Found value for this attribute
                
                if found_val is not None:
                    extracted[attr_name] = found_val
        return extracted

    def process(self, rows: List[Dict], return_logs: bool = False) -> Union[str, Dict]:
        """
        Main entry point. 
        If return_logs is True, returns a dict with 'text' and 'logs'.
        Otherwise returns just the enriched text string.
        """
        enriched_lines = []
        debug_logs = {
            "ignored_rows": [],      # List of {id, time, content, reason}
            "delayed_rows": [],      # List of {id, time, content, delay_min}
            "attribute_rows": []     # List of {id, time, content, extracted_attrs}
        }
        
        # We need "装置时间" (Device Time) to check for delay.
        # Assuming "时间" column is the upload time/log time, and there might be an inner "Device Time"?
        # Or user means: Content has "Time" and Row has "Time".
        # User said: "只要信息内容中有时间信息，且该时间比装置时间早超过10分钟".
        # Let's assume Row Time = Device Time (or Upload Time), and Content might contain another timestamp.
        # Actually usually: Row Time = Log Time (Device Time). 
        # Wait, if "Upload Time" is later than "Device Time"? 
        # Let's look for timestamp in Content.
        
        timestamp_pattern = re.compile(r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})")

        for row in rows:
            # 1. Get Basic Info
            row_id = row.get("id")
            time_str = self._get_value_from_cells(row, "时间") or self._get_value_from_cells(row, "Time")
            content_val = self._get_value_from_cells(row, "内容") or self._get_value_from_cells(row, "Content")
            
            # Skip if empty content
            if not content_val:
                continue

            tags = []

            # === 2. Rule-Based Tagging ===
            
            # A. Non-Critical Tagging
            is_non_critical = False
            # Check keywords
            for kw in self.TAG_CONFIG["non_critical"]["keywords"]:
                if kw in content_val:
                    is_non_critical = True
                    break
            # Check regex
            if not is_non_critical:
                for rx in self.TAG_CONFIG["non_critical"]["regex"]:
                    if re.search(rx, content_val):
                        is_non_critical = True
                        break
            
            if is_non_critical:
                tags.append("【ℹ️非关键】")
                if return_logs:
                    debug_logs["ignored_rows"].append({
                        "id": row_id,
                        "time": time_str,
                        "content": content_val,
                        "reason": "Matched non-critical keyword/regex"
                    })

            # B. Delayed Upload Tagging
            # "信息内容中有时间信息" -> Look for timestamp in content_val
            content_ts_match = timestamp_pattern.search(content_val)
            if content_ts_match and time_str:
                content_ts_str = content_ts_match.group(1)
                try:
                    # Row time (Device Time / Log Time)
                    row_dt = self._parse_timestamp(time_str)
                    # Content time (Event Time)
                    content_dt = self._parse_timestamp(content_ts_str)
                    
                    if row_dt and content_dt:
                        # Calculate difference in minutes
                        diff = (row_dt - content_dt).total_seconds() / 60
                        if diff > self.TAG_CONFIG["delayed_upload"]["threshold_minutes"]:
                            tags.append(f"【⏳延时上传:{int(diff)}分】")
                            if return_logs:
                                debug_logs["delayed_rows"].append({
                                    "id": row_id,
                                    "time": time_str,
                                    "content": content_val,
                                    "delay_min": int(diff)
                                })
                except:
                    pass # Date parsing failed, skip check

            # C. Human Operation Tagging (Purple)
            is_human = False
            cells = row.get("cells", {})
            if isinstance(cells, dict):
                for cell in cells.values():
                    if isinstance(cell, dict):
                        style = cell.get("style", {})
                        if isinstance(style, dict):
                            if self._is_purple_color(style.get("backgroundColor")):
                                is_human = True
                                break
            if "检修" in content_val or "机修工单" in content_val:
                is_human = True
            if is_human:
                tags.append("【⚠️现场人工操作】")

            # D. Work Order Tagging
            if "工单" in content_val:
                tags.append("【🚨高优先级-工单】")
            
            # === 3. Global Attribute Extraction ===
            # Use the helper method
            extracted_attrs_dict = self._extract_attributes(row)
            extracted_signals = [f"{k}={v}" for k, v in extracted_attrs_dict.items()]

            if extracted_signals and return_logs:
                debug_logs["attribute_rows"].append({
                    "id": row_id,
                    "time": time_str,
                    "content": content_val,
                    "extracted_attrs": extracted_signals
                })

            # === 4. Construct Final Line ===
            
            # Filter out non-critical lines IF we want to hide them from LLM to save tokens
            # But user said "打标", maybe LLM needs to know it's non-critical but still see it?
            # Or just hide it. Let's hide it if it's explicitly "Non-Critical" to reduce noise.
            # However, for "Delayed Upload", we want to show it.
            
            if "【ℹ️非关键】" in tags:
                # We can choose to skip adding this line to context
                # return or continue
                continue 

            line = f"[{time_str}]"
            if tags:
                line += " " + " ".join(tags)
            line += f" {content_val}"
            
            if extracted_signals:
                line += "\n   >> 全局属性: " + ", ".join(extracted_signals)
                
            enriched_lines.append(line)
            
        text_result = "\n".join(enriched_lines)
        
        if return_logs:
            return {"text": text_result, "logs": debug_logs}
        return text_result

@app.post("/api/debug/preview_rules")
async def preview_rules(request: AnalysisRequest):
    """
    Debug endpoint to preview how rules are applied to the data.
    Returns detailed logs of ignored rows, delayed uploads, and extracted attributes.
    """
    try:
        preprocessor = TimelinePreprocessor()
        result = preprocessor.process(request.rows, return_logs=True)
        return result["logs"]
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/analyze")
async def analyze_events(request: AnalysisRequest):
    """
    Analyze a list of events using LLM with domain knowledge injection.
    """
    try:
        # 1. Preprocess rows using Domain Logic
        preprocessor = TimelinePreprocessor()
        data_context = preprocessor.process(request.rows)
        
        if not data_context:
            return {"analysis": "根据预设规则，所选数据中没有发现高价值信息（可能已被过滤）。"}

        # 2. Construct Prompt
        system_prompt = """
你是一个电梯工业数据分析专家。请基于提供的时间线事件数据进行解读。

【分析原则】
1. **高优先级**：工单 > 故障发生(有效) > 故障恢复。这些通常意味着发生了停梯或严重问题。
2. **人工操作**：标记为【⚠️现场人工操作】的时间段，代表维保人员在现场。在此期间产生的故障可能是调试过程，需结合上下文区分。
3. **关键信号**：
   - 关注 '关键信号' 行的数据。
   - 安全回路(Safety Circuit)断开通常是故障根源。
   - 门锁回路(Door Lock)断开会导致电梯急停。
4. **忽略项**：已被标记为【⬇️已降权】或未出现在列表中的警告类信息请忽略。

【输出要求】
1. **结论先行**：第一句话直接告诉用户发生了什么（例如：“电梯在4楼因安全回路断开导致急停，随后维保人员到场检修”）。
2. **证据链**：列出支持你结论的关键事件和时间点。
3. **排版**：使用 Markdown，重点加粗。
"""
        
        user_prompt = f"""
请分析以下事件数据：

{data_context}

用户补充背景：
{request.context}
"""

        # 3. Call LLM
        response = client.chat.completions.create(
            model="gpt-3.5-turbo", 
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.3
        )
        
        return {"analysis": response.choices[0].message.content}
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

def process_d240_faults(rows: List[Dict], headers: List[str]) -> List[Dict]:
    """
    Process '故障代码D240' rows:
    1. Sort by Inner Time, then Inner MS.
    2. Merge faults with identical (Device Time, Inner Time, Inner MS).
    3. Merged format: [InnerTime InnerMS] ['Fault1']['Fault2']...
    """
    if not rows:
        return rows
        
    content_col = next((h for h in headers if "内容" in h), None)
    time_col = next((h for h in headers if "时间" in h), None)
    type_col = next((h for h in headers if "类型" in h), None)
    
    if not content_col or not time_col:
        return rows
        
    # Helper to parse inner timestamp
    # Format: [2025-12-08 10:18:04 120ms] ...
    # Regex groups: (Date Time), (MS)
    inner_time_pattern = re.compile(r"\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(\d+)ms\]")
    
    # Helper to extract fault code for sorting
    # Format: '434(安全回路（#29）断开)'
    fault_code_pattern = re.compile(r"^\s*'([A-Za-z0-9]+)")
    
    # Group rows by Device Time
    # Key: str(device_time_value) -> List of row indices
    device_time_groups = {}
    for i, row in enumerate(rows):
        t_val = row["cells"].get(time_col, {}).get("value")
        t_key = str(t_val) if t_val else "UNKNOWN"
        if t_key not in device_time_groups:
            device_time_groups[t_key] = []
        device_time_groups[t_key].append(i)
        
    # Set of indices to remove (merged into others)
    indices_to_remove = set()
    
    # Map of index -> new row data (if modified/merged)
    modified_rows = {}
    
    for t_key, indices in device_time_groups.items():
        # Identify D240 rows in this group
        d240_indices = []
        for idx in indices:
            row = rows[idx]
            # Check type or content for "故障代码D240"
            # User said: "故障代码D240" is likely in type column or content
            type_val = str(row["cells"].get(type_col, {}).get("value", "")) if type_col else ""
            content_val = str(row["cells"].get(content_col, {}).get("value", ""))
            
            if "故障代码D240" in type_val or "故障代码D240" in content_val:
                d240_indices.append(idx)
        
        if not d240_indices:
            continue
            
        # Parse D240 rows
        # List of dicts: {idx, inner_time_str, inner_ms_int, fault_content_str}
        parsed_d240 = []
        for idx in d240_indices:
            content_val = str(rows[idx]["cells"].get(content_col, {}).get("value", ""))
            match = inner_time_pattern.search(content_val)
            if match:
                inner_time = match.group(1)
                inner_ms = int(match.group(2))
                # Extract fault content part: everything after ]
                # e.g. " ['697(...)']"
                fault_part = content_val[match.end():].strip()
            else:
                # Fallback if pattern doesn't match, treat as 0 timestamp?
                # Or just ignore sorting for this one
                inner_time = "0000-00-00 00:00:00"
                inner_ms = 0
                fault_part = content_val
            
            parsed_d240.append({
                "idx": idx,
                "inner_time": inner_time,
                "inner_ms": inner_ms,
                "fault_part": fault_part
            })
            
        # Group by (inner_time, inner_ms) for merging
        merge_groups = {}
        for item in parsed_d240:
            key = (item["inner_time"], item["inner_ms"])
            if key not in merge_groups:
                merge_groups[key] = []
            merge_groups[key].append(item)
            
        # Process each merge group
        # Result: List of new row objects (merged)
        final_d240_rows = []
        
        # We need to process merge groups in order of time key
        sorted_keys = sorted(merge_groups.keys(), key=lambda k: (k[0], k[1]))
        
        for key in sorted_keys:
            items = merge_groups[key]
            
            # Collect all faults
            all_faults = []
            for item in items:
                # fault_part might be "['Code(...)']" or multiple "['A'] ['B']" ?
                # User example: "['697(...)']"
                # We need to extract individual ['...'] blocks or just parse the strings
                # Let's simple find all matches of \['[^']+?\'\]
                # or just use the fault_part string if it's simple.
                # User wants to sort by code.
                
                # Regex to find ['...'] blocks
                # Assuming standard python list repr or user's bracketed format
                # Example: "['434(...)']"
                
                # Let's find all occurrences of ['...']
                # Be careful with nested brackets if any, but fault codes usually simple.
                
                fault_matches = re.findall(r"(\['[^']+'\])", item["fault_part"])
                if not fault_matches:
                    # Maybe it's not bracketed? Just add whole part
                    all_faults.append((item["fault_part"], "0"))
                else:
                    for f_str in fault_matches:
                        # Extract code for sorting
                        # f_str is "['434(...)']"
                        # Clean to "434(...)"
                        inner_str = f_str[2:-2] # remove [' and ']
                        # Extract code
                        code_match = fault_code_pattern.search(inner_str)
                        code = code_match.group(1) if code_match else inner_str
                        all_faults.append((f_str, code))
            
            # Sort faults by code
            # Assuming alphanumeric sort
            all_faults.sort(key=lambda x: x[1])
            
            # Construct merged content
            # Format: [Time MS] ['Fault1']['Fault2']
            inner_time, inner_ms = key
            merged_faults_str = "".join([f[0] for f in all_faults])
            new_content = f"[{inner_time} {inner_ms}ms] {merged_faults_str}"
            
            # We use the FIRST index of this group to hold the result
            # But wait, we are reordering everything within the Device Time group.
            # So we will just generate a list of row contents to place back into the d240_indices slots.
            
            final_d240_rows.append(new_content)
            
        # Now we have sorted, merged contents: final_d240_rows
        # And we have original indices: d240_indices
        
        # We place the new contents into the first N indices of d240_indices
        # And mark the remaining indices for removal
        
        for i in range(len(d240_indices)):
            orig_idx = d240_indices[i]
            if i < len(final_d240_rows):
                # Update this row
                # We need to deep copy the row to avoid mutating original list reference directly until we build result
                # But here we can just prepare a modification
                new_content = final_d240_rows[i]
                
                # Clone row
                old_row = rows[orig_idx]
                new_row = old_row.copy()
                new_row["cells"] = old_row["cells"].copy()
                new_row["cells"][content_col] = old_row["cells"][content_col].copy()
                new_row["cells"][content_col]["value"] = new_content
                
                modified_rows[orig_idx] = new_row
            else:
                # This slot is no longer needed (merged into previous)
                indices_to_remove.add(orig_idx)
                
    # Reconstruct rows list
    new_rows = []
    for i, row in enumerate(rows):
        if i in indices_to_remove:
            continue
        if i in modified_rows:
            new_rows.append(modified_rows[i])
        else:
            new_rows.append(row)
            
    return new_rows

def aggregate_traces(rows: List[Dict], headers: List[str]) -> List[Dict]:
    """
    Aggregate Control Trace (53552 center) and Management Trace (53504 center).
    """
    if not rows:
        return rows

    # Find the index of "信息内容" or similar column
    content_col = next((h for h in headers if "内容" in h), None)
    time_col = next((h for h in headers if "时间" in h), None)
    
    if not content_col:
        return rows

    # Helper to extract ID from content
    def extract_id(text):
        if not text:
            return None
        match = re.search(r'Trace[:：]\s*(\d+)', str(text))
        if match:
            return match.group(1)
        return None

    # Helper to extract timestamp string from content (e.g. [2025...])
    def extract_content_timestamp(text):
        if not text:
            return ""
        match = re.search(r'(\[[^\]]+\])', str(text))
        if match:
            return match.group(1)
        return ""

    processed_rows = []
    skip_indices = set()
    
    # We iterate by index to look ahead/behind
    # Group rows by timestamp first? 
    # Actually, scanning neighbors is safer because they might not be strictly sorted by time if milliseconds differ slightly or are missing.
    # But usually they are adjacent.
    
    # Let's group by timestamp first to make it robust
    # Map: timestamp -> list of (index, row)
    # But "timestamp" column value might differ slightly? 
    # The example shows identical "装置时间": 2025-12-08 10:58:17
    
    rows_by_time = {}
    for i, row in enumerate(rows):
        t_val = row["cells"].get(time_col, {}).get("value")
        if t_val:
            # Convert to string to use as key
            t_key = str(t_val)
            if t_key not in rows_by_time:
                rows_by_time[t_key] = []
            rows_by_time[t_key].append((i, row))
        else:
            # No time, treat as unique group? Or just separate.
            # We'll just append them to processed_rows if they are not skipped
            pass

    # Target sets
    control_target = {'53552', '53553', '53554', '53555', '53556', '53557', '53558'}
    mgmt_target = {'53504', '53505', '53506', '53507', '53508'}
    
    replacements = {} # Map index -> new content string

    # First pass: Identify clusters and mark rows to skip
    for i, row in enumerate(rows):
        # We only look for centers here
        content_cell = row["cells"].get(content_col, {})
        content_text = content_cell.get("value", "")
        trace_id = extract_id(content_text)
        
        if trace_id == '53552':
            # Control Trace Center
            t_val = row["cells"].get(time_col, {}).get("value")
            t_key = str(t_val) if t_val else None
            
            candidates = rows_by_time.get(t_key, [(i, row)])
            
            found_ids = set()
            cluster_indices = []
            
            for c_idx, c_row in candidates:
                # Don't claim rows already claimed by another cluster?
                # But here we are just finding members.
                # If a row is a member of multiple clusters (impossible with current ID sets), we might have issue.
                # Assuming disjoint sets.
                
                c_text = c_row["cells"].get(content_col, {}).get("value", "")
                c_id = extract_id(c_text)
                
                if c_id in control_target:
                    found_ids.add(c_id)
                    cluster_indices.append(c_idx)
            
            # Generate summary
            timestamp_str = extract_content_timestamp(content_text)
            missing = sorted(list(control_target - found_ids))
            
            if not missing:
                summary = f"控制Trace{timestamp_str}（完整）"
            else:
                missing_str = "、".join(missing)
                summary = f"控制Trace{timestamp_str} 缺少{missing_str}数据"
            
            replacements[i] = summary
            
            # Mark members to skip (excluding the center itself, which we will handle via replacements)
            for c_idx in cluster_indices:
                if c_idx != i:
                    skip_indices.add(c_idx)

        elif trace_id == '53504':
            # Management Trace Center
            t_val = row["cells"].get(time_col, {}).get("value")
            t_key = str(t_val) if t_val else None
            
            candidates = rows_by_time.get(t_key, [(i, row)])
            
            found_ids = set()
            cluster_indices = []
            
            for c_idx, c_row in candidates:
                c_text = c_row["cells"].get(content_col, {}).get("value", "")
                c_id = extract_id(c_text)
                
                if c_id in mgmt_target:
                    found_ids.add(c_id)
                    cluster_indices.append(c_idx)
            
            # Generate summary
            timestamp_str = extract_content_timestamp(content_text)
            missing = sorted(list(mgmt_target - found_ids))
            
            if not missing:
                summary = f"管理Trace{timestamp_str}（完整）"
            else:
                missing_str = "、".join(missing)
                summary = f"管理Trace{timestamp_str} 缺少{missing_str}数据"
            
            replacements[i] = summary
            
            for c_idx in cluster_indices:
                if c_idx != i:
                    skip_indices.add(c_idx)

    # Second pass: Build result
    for i, row in enumerate(rows):
        if i in skip_indices:
            continue
            
        if i in replacements:
            new_row = row.copy()
            new_row["cells"] = row["cells"].copy()
            new_row["cells"][content_col] = row["cells"][content_col].copy()
            new_row["cells"][content_col]["value"] = replacements[i]
            processed_rows.append(new_row)
        else:
            processed_rows.append(row)
            
    return processed_rows

import math

def clean_for_json(obj):
    """
    Recursively clean dictionary/list to replace NaN/Infinity with None or string,
    ensuring JSON compatibility for standard JSON parsers (like in browsers).
    """
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    elif isinstance(obj, dict):
        return {k: clean_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [clean_for_json(v) for v in obj]
    return obj

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    if not file.filename.endswith('.xlsx'):
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload an Excel file.")
    
    content = await file.read()
    
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
        
        # Find the target sheet
        target_sheet_name = None
        for name in wb.sheetnames:
            if "时间线" in name or "Timeline" in name:
                target_sheet_name = name
                break
        
        if not target_sheet_name:
            # Fallback to first sheet if no timeline sheet found
            target_sheet_name = wb.sheetnames[0]
            
        ws = wb[target_sheet_name]
        
        headers = [str(cell.value) if cell.value is not None else "" for cell in ws[1]]
        
        rows = []
        for row_idx, row in enumerate(ws.iter_rows(min_row=2), start=2):
            row_data = {
                "id": row_idx,
                "cells": {}
            }
            
            # Check if row has any content
            has_content = False
            
            for col_idx, cell in enumerate(row):
                if col_idx >= len(headers):
                    break
                
                col_name = headers[col_idx]
                val = cell.value
                
                if val is not None:
                    has_content = True
                
                # Extract styles
                bg_color = get_rgb_color(cell.fill.fgColor) if cell.fill else None
                font_color = get_rgb_color(cell.font.color) if cell.font else None
                
                # Extract comment
                comment = cell.comment.text if cell.comment else None
                
                cell_data = {
                    "value": val,
                    "style": {},
                    "comment": comment
                }
                
                if bg_color and bg_color.upper() not in ['#000000', '#FFFFFF', '#00FFFFFF']:
                    cell_data["style"]["backgroundColor"] = bg_color
                
                if font_color and font_color.upper() not in ['#000000', '#00FFFFFF']:
                    cell_data["style"]["color"] = font_color
                
                row_data["cells"][col_name] = cell_data
            
            if has_content:
                rows.append(row_data)
        
        # Aggregate trace data
        rows = aggregate_traces(rows, headers)
        
        # Process D240 faults (sort and merge)
        rows = process_d240_faults(rows, headers)
        
        # Enrich with global attributes
        preprocessor = TimelinePreprocessor()
        for row in rows:
            row["global_attributes"] = preprocessor._extract_attributes(row)

        result = {
            "sheet_name": target_sheet_name,
            "headers": headers,
            "rows": rows
        }
        
        return clean_for_json(result)

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
