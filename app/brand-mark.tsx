import Image from "next/image";

/** 标志没有语言差异，读屏名称由外层的本地化链接提供。 */
export default function BrandMark() {
  return (
    <span className="brand-mark brand-mark-symbol" aria-hidden="true">
      <Image
        src="/logo.svg?v=cat"
        alt=""
        width={48}
        height={48}
        unoptimized
        loading="eager"
        draggable={false}
      />
    </span>
  );
}
