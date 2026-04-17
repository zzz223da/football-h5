// 极简路由测试，仅返回路径信息
export default async (req) => {
  const url = new URL(req.url);
  return new Response(`✅ 路由匹配成功！当前路径：${url.pathname}`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
};
