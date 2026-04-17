// 极简测试：只验证密码，返回成功
const SECRET = '123456789';

export default async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');

  if (token !== SECRET) {
    return new Response(JSON.stringify({ error: '密码错误' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ 
    success: true, 
    message: '边缘函数运行正常！',
    time: new Date().toISOString()
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
