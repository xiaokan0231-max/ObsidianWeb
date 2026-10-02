import { NextResponse, type NextRequest } from "next/server";
import { calendarRedirectHref } from "./app/app-route";

// 在请求层保留原查询，避免 vinext 页面预检查丢失 searchParams 后提前跳转。
export function proxy(request: NextRequest) {
  return NextResponse.redirect(new URL(calendarRedirectHref(request.nextUrl.searchParams), request.url));
}

export const config = { matcher: ["/", "/actions"] };
