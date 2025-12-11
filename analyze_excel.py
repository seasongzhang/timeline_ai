import pandas as pd
import os

# 设置目标文件路径
file_path = '/Users/seasong/Nutstore Files/我的坚果云/python/timeline_ai/data/23N4B16-474-43等_20251211084439_Both.xlsx'

def analyze_excel(path):
    # 检查文件是否存在
    if not os.path.exists(path):
        print(f"错误：文件未找到 - {path}")
        return

    try:
        # 加载 Excel 文件
        xls = pd.ExcelFile(path)
        print(f"✅ 成功加载文件：{os.path.basename(path)}")
        print(f"📑 包含的工作表：{xls.sheet_names}")
        print("="*50)

        # 优先查找 "时间线" 表
        target_sheet = None
        for name in xls.sheet_names:
            if "时间线" in name or "Timeline" in name:
                target_sheet = name
                break
        
        if target_sheet:
            print(f"🎯 找到目标工作表：[{target_sheet}]")
            df = pd.read_excel(xls, sheet_name=target_sheet)
            
            print(f"  - 数据维度：{df.shape[0]} 行, {df.shape[1]} 列")
            print(f"  - 列名列表：{df.columns.tolist()}")
            
            print("\n  - 数据预览 (前 20 行)：")
            # 显示更多行和列宽
            pd.set_option('display.max_columns', None)
            pd.set_option('display.max_rows', 50)
            pd.set_option('display.width', 1000)
            pd.set_option('display.max_colwidth', 100)
            
            print(df.head(20).to_string())
            
            # 尝试筛选Trace相关信息
            print("\n  - 🔍 Trace数据分析 (包含 'Trace' 的行)：")
            mask_trace = df.astype(str).apply(lambda x: x.str.contains('Trace', na=False)).any(axis=1)
            trace_df = df[mask_trace]
            if not trace_df.empty:
                print(f"    找到 {len(trace_df)} 条Trace记录，显示部分相关ID序列：")
                # 尝试提取ID
                # 假设包含数字，我们显示包含 53552, 53553 等数字的行
                keywords = ['53552', '53553', '53554', '53555', '53556', '53557', '53558', '53504', '53505']
                mask_ids = trace_df.astype(str).apply(lambda x: x.str.contains('|'.join(keywords), na=False)).any(axis=1)
                id_df = trace_df[mask_ids]
                if not id_df.empty:
                     print(id_df.head(50).to_string())
                else:
                     print("    未找到指定Trace ID (53552, 53504等) 的记录")
            else:
                print("    未在数据中显式匹配到 'Trace' 关键字。")

        else:
            print("⚠️ 未找到名为 '时间线' 或 'Timeline' 的工作表。将分析第一个工作表。")
            first_sheet = xls.sheet_names[0]
            print(f"正在分析工作表：[{first_sheet}]")
            df = pd.read_excel(xls, sheet_name=first_sheet)
            print(df.head(20).to_string())
            
    except Exception as e:
        print(f"❌ 读取失败：{str(e)}")

if __name__ == "__main__":
    analyze_excel(file_path)
