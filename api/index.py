import sys
import os

# 将项目根目录添加到 python path，以便可以导入 backend 模块
# Vercel 环境下，__file__ 是 api/index.py
# os.path.dirname(__file__) 是 api/
# os.path.dirname(...) 是项目根目录
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.main import app

# Vercel Serverless Function entry point
# FastAPI app instance is automatically detected if named 'app'
