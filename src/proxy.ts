import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Rotas que existem sem sessão. `/proposta` é a ferramenta do corretor,
// `/condicoes` é a página que ele envia ao cliente, `/primeiro-acesso` é o
// link de convite que ele recebe no WhatsApp e `/acompanhar` é o link
// permanente do comprador: quem tem o link entra, sem conta e sem senha.
// `/api/asaas/webhook` são os avisos do Asaas e `/api/cron` as rotinas que a
// Vercel dispara — nenhum dos dois tem sessão; cada rota confere o próprio
// segredo antes de qualquer coisa.
const PUBLIC_ROUTES = [
  "/login",
  "/proposta",
  "/condicoes",
  "/primeiro-acesso",
  "/acompanhar",
  "/api/asaas/webhook",
  "/api/cron",
  "/minuta",
];

/**
 * A rota é pública se for EXATAMENTE uma da lista, ou um caminho abaixo dela.
 *
 * Era um `startsWith` simples, e com `/simulador` nunca deu problema porque
 * nenhuma rota do painel começava com essa palavra. Com `/proposta` dá: o
 * painel tem `/propostas`, e `"/propostas".startsWith("/proposta")` é
 * verdadeiro — a fila de propostas da Trilha teria virado página pública, sem
 * erro nenhum na tela, só o RLS segurando. Comparar por segmento fecha essa
 * classe inteira de acidente, não só este caso.
 */
const ehPublica = (pathname: string) =>
  PUBLIC_ROUTES.some((rota) => pathname === rota || pathname.startsWith(`${rota}/`));

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = ehPublica(pathname);

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    // A raiz decide para onde ir conforme o papel — não duplicar a regra aqui.
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
