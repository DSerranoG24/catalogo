import Image from "next/image";

type ProductPreviewProps = {
  nombre: string;
  precio: string;
  categoria: string;
  descripcion: string;
  imagen: string;
};

export default function ProductPreview({
  nombre,
  precio,
  categoria,
  descripcion,
  imagen,
}: ProductPreviewProps) {
  return (
    <div className="rounded-xl border bg-white p-6 shadow-sm">
      <p className="mb-4 text-sm font-medium text-gray-500">
        Vista previa
      </p>

      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="flex aspect-square items-center justify-center bg-gray-100">
          {imagen ? (
            <Image
              src={imagen}
              alt={nombre || "Producto"}
              width={600}
              height={600}
              unoptimized
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-sm text-gray-400">
              Imagen del producto
            </span>
          )}
        </div>

        <div className="p-4">
          {categoria && (
            <p className="text-xs font-medium uppercase text-gray-400">
              {categoria}
            </p>
          )}

          <h3 className="mt-1 text-lg font-semibold text-gray-900">
            {nombre || "Nombre del producto"}
          </h3>

          <p className="mt-2 text-xl font-bold text-gray-900">
            {precio ? `$${Number(precio).toLocaleString("es-CO")}` : "$0"}
          </p>

          {descripcion && (
            <p className="mt-3 text-sm text-gray-500">
              {descripcion}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}