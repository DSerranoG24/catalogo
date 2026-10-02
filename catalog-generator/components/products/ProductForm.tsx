"use client";

type ProductFormProps = {
  nombre: string;
  precio: string;
  categoria: string;
  descripcion: string;
  imagen: string;

  setNombre: (value: string) => void;
  setPrecio: (value: string) => void;
  setCategoria: (value: string) => void;
  setDescripcion: (value: string) => void;
  setImagen: (value: string) => void;
};

export default function ProductForm({
  nombre,
  precio,
  categoria,
  descripcion,
  imagen,
  setNombre,
  setPrecio,
  setCategoria,
  setDescripcion,
  setImagen,
}: ProductFormProps) {
  
  const manejarImagen = (archivo: File | undefined) => {
    if (!archivo) return;

    const lector = new FileReader();

    lector.onload = () => {
      if (typeof lector.result === "string") {
        setImagen(lector.result);
      }
    };

    lector.readAsDataURL(archivo);
  };

  return (
    <div className="space-y-6">

      {/* NOMBRE */}
      <div>
        <label
          htmlFor="nombre"
          className="block text-sm font-medium text-gray-700"
        >
          Nombre del producto
        </label>

        <input
          id="nombre"
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej: Funda Samsung A15"
          className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-black"
        />
      </div>

      {/* PRECIO */}
      <div>
        <label
          htmlFor="precio"
          className="block text-sm font-medium text-gray-700"
        >
          Precio
        </label>

        <input
          id="precio"
          type="number"
          value={precio}
          onChange={(e) => setPrecio(e.target.value)}
          placeholder="25000"
          className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-black"
        />
      </div>

      {/* CATEGORÍA */}
      <div>
        <label
          htmlFor="categoria"
          className="block text-sm font-medium text-gray-700"
        >
          Categoría
        </label>

        <input
          id="categoria"
          type="text"
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          placeholder="Ej: Fundas"
          className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-black"
        />
      </div>

      {/* DESCRIPCIÓN */}
      <div>
        <label
          htmlFor="descripcion"
          className="block text-sm font-medium text-gray-700"
        >
          Descripción
        </label>

        <textarea
          id="descripcion"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Describe el producto..."
          rows={4}
          className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-black"
        />
      </div>

      {/* IMAGEN */}
      <div>
        <label
          htmlFor="imagen"
          className="block text-sm font-medium text-gray-700"
        >
          Imagen del producto
        </label>

        <input
          id="imagen"
          type="file"
          accept="image/png, image/jpeg, image/webp"
          onChange={(e) => manejarImagen(e.target.files?.[0])}
          className="mt-2 block w-full cursor-pointer rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm"
        />

        <p className="mt-2 text-xs text-gray-500">
          Formatos permitidos: JPG, PNG y WebP.
        </p>

        {imagen && (
          <p className="mt-2 text-xs text-green-600">
            ✓ Imagen seleccionada
          </p>
        )}
      </div>

    </div>
  );
}