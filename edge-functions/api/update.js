// edge-functions/api/update.js
const fs = require('fs');
const fetch = require('node-fetch');

// ========== 环境变量 ==========
const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY || '';
const ODDS_API_KEY = process.env.ODDS_API_KEY || '';
const UPDATE_SECRET = process.env.UPDATE_SECRET || '123456789';

// ========== 核心预测逻辑（精简版，保留完整因子） ==========
// ... 这里包含了您之前 update.js 里的所有计算函数（poisson, elo, 因子等）...
// （因篇幅限制，此处用注释代替，实际替换时需要把完整的计算逻辑放进来）
async function generateData() {
    // 这里是原来的 main() 函数内容，负责拉取 API、计算概率、生成 data.json
    // 最终返回生成的数据对象
    return { date: new Date().toISOString().split('T')[0], matches: [] };
}

// ========== H5 页面 HTML（内嵌） ==========
const htmlPage = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>122 足球预测 · 合一版</title>
    <style>
        :root { --bg: #f5f7fa; --card-bg: #ffffff; --text-primary: #1e293b; --text-secondary: #64748b; --border: #eef2f6; --accent: #3b82f6; --success: #059669; --warning: #d97706; --danger: #dc2626; }
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: system-ui, sans-serif; }
        body { background: var(--bg); color: var(--text-primary); padding: 16px; max-width: 450px; margin: 0 auto; }
        .header { display: flex; justify-content: space-between; margin-bottom: 20px; }
        .card { background: var(--card-bg); border-radius: 16px; padding: 16px; margin-bottom: 16px; border: 1px solid var(--border); }
        .btn { background: var(--accent); color: #fff; border: none; padding: 12px; border-radius: 30px; font-size: 16px; cursor: pointer; width: 100%; }
        .loading { text-align: center; padding: 40px; color: var(--text-secondary); }
    </style>
</head>
<body>
    <div class="header">
        <h1>⚽ 122预测</h1>
        <button id="refreshBtn" class="btn" style="width:auto; padding:8px 16px;">🔄 刷新</button>
    </div>
    <div id="content" class="loading">加载数据中...</div>
    <script>
        const UPDATE_SECRET = '123456789';
        async function loadData() {
            try {
                const res = await fetch('/data.json');
                const data = await res.json();
                render(data);
            } catch { document.getElementById('content').innerHTML = '加载失败'; }
        }
        function render(data) {
            let
