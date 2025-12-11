from backend.main import aggregate_traces

def test_aggregation():
    headers = ["装置时间", "信息内容"]
    
    # Mock data
    # Case 1: Complete Control Trace
    # Case 2: Incomplete Control Trace (missing 53553)
    # Case 3: Complete Management Trace
    # Case 4: Other rows
    
    rows = [
        # Group 1: Complete Control Trace (Time 10:00:00)
        {"id": 1, "cells": {"装置时间": {"value": "10:00:00"}, "信息内容": {"value": "控制Trace: 53553"}}},
        {"id": 2, "cells": {"装置时间": {"value": "10:00:00"}, "信息内容": {"value": "[10:00:00 123ms] 控制Trace: 53552"}}},
        {"id": 3, "cells": {"装置时间": {"value": "10:00:00"}, "信息内容": {"value": "控制Trace: 53558"}}},
        {"id": 4, "cells": {"装置时间": {"value": "10:00:00"}, "信息内容": {"value": "控制Trace: 53554"}}},
        {"id": 5, "cells": {"装置时间": {"value": "10:00:00"}, "信息内容": {"value": "控制Trace: 53555"}}},
        {"id": 6, "cells": {"装置时间": {"value": "10:00:00"}, "信息内容": {"value": "控制Trace: 53556"}}},
        {"id": 7, "cells": {"装置时间": {"value": "10:00:00"}, "信息内容": {"value": "控制Trace: 53557"}}},
        
        # Group 2: Incomplete Control Trace (Time 10:01:00) - Missing 53553
        {"id": 8, "cells": {"装置时间": {"value": "10:01:00"}, "信息内容": {"value": "[10:01:00 456ms] 控制Trace: 53552"}}},
        {"id": 9, "cells": {"装置时间": {"value": "10:01:00"}, "信息内容": {"value": "控制Trace: 53558"}}},
        {"id": 10, "cells": {"装置时间": {"value": "10:01:00"}, "信息内容": {"value": "控制Trace: 53554"}}},
        {"id": 11, "cells": {"装置时间": {"value": "10:01:00"}, "信息内容": {"value": "控制Trace: 53555"}}},
        {"id": 12, "cells": {"装置时间": {"value": "10:01:00"}, "信息内容": {"value": "控制Trace: 53556"}}},
        {"id": 13, "cells": {"装置时间": {"value": "10:01:00"}, "信息内容": {"value": "控制Trace: 53557"}}},
        
        # Group 3: Complete Management Trace (Time 10:02:00)
        {"id": 14, "cells": {"装置时间": {"value": "10:02:00"}, "信息内容": {"value": "[10:02:00 789ms] 管理Trace: 53504"}}},
        {"id": 15, "cells": {"装置时间": {"value": "10:02:00"}, "信息内容": {"value": "管理Trace: 53505"}}},
        
        # Group 4: Unrelated row
        {"id": 16, "cells": {"装置时间": {"value": "10:03:00"}, "信息内容": {"value": "其他信息"}}},
    ]
    
    processed = aggregate_traces(rows, headers)
    
    print(f"Original rows: {len(rows)}")
    print(f"Processed rows: {len(processed)}")
    
    for row in processed:
        print(f"Row Content: {row['cells']['信息内容']['value']}")

if __name__ == "__main__":
    test_aggregation()
