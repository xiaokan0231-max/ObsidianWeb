/** 访客能阅读全部页面，但不能改案件、练习记录或触发本机 AI 操作。 */
export function publishedRequestResponse(request: Request, published: boolean): Response | null {
  if (!published) return null;
  const url = new URL(request.url);
  if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain" } });
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    return Response.json({ error: "线上版本只供查看；请在本机更新后重新发布" }, { status: 403 });
  }
  return null;
}
