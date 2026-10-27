import LegalPage, { PendingReview } from "@/components/legal/LegalPage";
import { legalMetadata } from "@/lib/legal-metadata";

export const metadata = legalMetadata("/terminos", "Términos de uso", "Descripción de Vitrinaya, reglas de uso, pedidos e inventario informativo. Condiciones pendientes de revisión jurídica.");

export default function TermsPage() {
  return <LegalPage title="Términos de uso">
    <p>Este documento describe el servicio y sus reglas de uso. Las condiciones señaladas están pendientes de revisión jurídica y no se presentan como un texto legal definitivo.</p>
    <h2>Qué ofrece Vitrinaya</h2>
    <p>Vitrinaya permite al vendedor administrar productos, publicar un catálogo con enlace propio, recibir solicitudes de pedido y generar cotizaciones PDF para continuar la conversación por WhatsApp.</p>
    <h2>Uso por parte del vendedor</h2>
    <p>El vendedor puede gestionar sus catálogos, productos, precios e imágenes y atender los pedidos recibidos. Debe mantener información comprensible y actualizada. No está permitido ofrecer productos ilegales ni subir contenido de terceros sin permiso.</p>
    <h2>Productos, precios y pedidos</h2>
    <p>El vendedor es responsable de la información de sus productos, precios y de la atención y confirmación de sus pedidos. Vitrinaya proporciona la herramienta; no participa en la transacción comercial ni procesa o cobra pagos de esas ventas. Un pedido registrado es una solicitud, no una compra pagada ni una confirmación del vendedor.</p>
    <PendingReview>Revisar y delimitar las responsabilidades entre plataforma, vendedores y compradores, y las condiciones de prestación del servicio.</PendingReview>
    <h2>Inventario informativo</h2>
    <p>El stock es informativo. Registrar un pedido no reserva ni descuenta inventario y no garantiza disponibilidad. El vendedor debe confirmar la solicitud.</p>
    <h2>Cambios e interrupciones del servicio</h2>
    <p>El servicio puede experimentar incidencias o cambios. No se ofrece aquí una garantía de disponibilidad ni un mecanismo de compensación no definido. Las incidencias pueden comunicarse por correo.</p>
    <PendingReview>Definir cómo se comunicarán los cambios, interrupciones, mantenimiento y recuperación del servicio.</PendingReview>
    <h2>Limitación de responsabilidad</h2>
    <PendingReview>Redactar y revisar esta sección. No se establece una exclusión general de responsabilidad ni una renuncia de derechos.</PendingReview>
    <h2>Modificaciones de los términos</h2>
    <PendingReview>Definir el procedimiento de modificación, aviso, versión y aplicación de nuevas condiciones. No se considera aceptado un cambio por el mero acceso al sitio.</PendingReview>
    <h2>Contacto e identificación</h2>
    <p>Vitrinaya es operada por una persona individual en Colombia. Consultas: <a href="mailto:vitrinaya983@gmail.com">vitrinaya983@gmail.com</a>.</p>
    <PendingReview>Completar identificación de la persona operadora, datos identificativos o NIT y dirección que correspondan, y jurisdicción.</PendingReview>
  </LegalPage>;
}
