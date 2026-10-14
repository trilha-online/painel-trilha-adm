// Logo oficial da Trilha (wordmark), vetorizado do PNG da marca.
// Pinta com a cor do texto (currentColor): azul no fundo claro, branco no fundo azul.

const TRILHA =
  "M0 0H291V72H183V361H107V72H0Z" +
  "M337 0H564L619 54V165L584 201L623 240V361H551V258L516 223H407V361H337ZM407 59H531L550 78V147L532 162H407Z" +
  "M688 0H758V361H688Z" +
  "M829 0H898V291H1079V361H829Z" +
  "M1116 0H1185V146H1334V0H1402V361H1334V215H1185V361H1116Z" +
  "M1559 0H1623L1749 361H1679L1654 281H1528L1503 361H1433ZM1592 86L1636 222H1546Z";

const T = "M0 0H291V72H183V361H107V72H0Z";

export function LogoTrilha({ className, titulo = "Trilha" }: { className?: string; titulo?: string }) {
  return (
    <svg viewBox="0 0 1751 361" className={className} fill="currentColor" fillRule="evenodd" role="img" aria-label={titulo}>
      <path d={TRILHA} />
    </svg>
  );
}

/** Só o "T" da marca, para espaços quadrados (menu lateral recolhido). */
export function SimboloTrilha({ className }: { className?: string }) {
  return (
    <svg viewBox="-35 0 361 361" className={className} fill="currentColor" aria-hidden="true">
      <path d={T} />
    </svg>
  );
}
