import Image from 'next/image';

export function SiteLogo() {
  return (
    <span className="flex h-8 items-center">
      <Image
        src="/tb-science-logo-light-bold.png"
        alt="Terminal-Bench Science"
        width={2449}
        height={468}
        className="h-8 w-auto dark:hidden"
      />
      <Image
        src="/tb-science-logo-dark-bold.png"
        alt="Terminal-Bench Science"
        width={2449}
        height={468}
        className="hidden h-8 w-auto dark:block"
      />
    </span>
  );
}
