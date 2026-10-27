import LegalPage, { PendingReview } from "@/components/legal/LegalPage";
import { legalMetadata } from "@/lib/legal-metadata";

export const metadata = legalMetadata("/privacidad", "Política de privacidad", "Información sobre los datos, proveedores, cookies y almacenamiento utilizados por Vitrinaya. Documento en revisión jurídica.");

export default function PrivacyPage() {
  return <LegalPage title="Política de privacidad">
    <p>Este documento describe el funcionamiento actual de Vitrinaya. Las secciones señaladas requieren revisión jurídica; no constituyen una declaración de cumplimiento legal.</p>
    <h2>Quién trata los datos</h2>
    <p>Vitrinaya es un proyecto operado por una persona individual en Colombia. Contacto: <a href="mailto:vitrinaya983@gmail.com">vitrinaya983@gmail.com</a>.</p>
    <PendingReview>Completar y revisar la identificación de la persona operadora, los datos identificativos o NIT que correspondan, dirección postal y responsabilidades entre Vitrinaya y los vendedores.</PendingReview>
    <h2>Qué datos se recogen</h2>
    <ul>
      <li><strong>Cuenta del vendedor:</strong> correo, nombre opcional, identificador de Google cuando se utiliza ese acceso, hash de contraseña si existe contraseña local, verificación del correo, rol, versión de sesión y fechas.</li>
      <li><strong>Recuperación y verificación:</strong> hash del token, finalidad, correo al emitirlo, fechas de creación, caducidad y consumo.</li>
      <li><strong>Perfil comercial:</strong> nombre, NIT opcional, correo, teléfonos, WhatsApp, dirección, horarios, ubicación, redes sociales, logo y condiciones de cotización. Estos datos pueden identificar a una persona y los que se publican en el catálogo son visibles para sus visitantes.</li>
      <li><strong>Clientes de los vendedores:</strong> nombre, teléfono, correo opcional, dirección, notas, fecha del consentimiento, productos, cantidades, importes, estado y fechas del pedido. Se trata de datos de terceros que realizan solicitudes al vendedor.</li>
      <li><strong>Cotizaciones:</strong> datos del pedido, instantánea de los datos del vendedor y token de acceso al PDF.</li>
      <li><strong>Reseñas:</strong> nombre visible opcional, puntuación, comentario, moderación y fechas.</li>
    </ul>
    <p>Las notas y los comentarios son texto libre y pueden contener datos no previstos en los campos del formulario. Evita incluir información personal que no sea necesaria.</p>
    <p>El formulario de contacto prepara un borrador local con nombre, correo y mensaje, sin enviarlo al servidor. Si decides enviarlo desde tu aplicación de correo, el destinatario recibe esos datos en el buzón de contacto de Gmail.</p>
    <h2>Para qué se usan</h2>
    <p>Para gestionar cuentas y accesos, verificar correos, recuperar contraseñas, publicar catálogos, gestionar solicitudes de pedido, generar cotizaciones y moderar reseñas. El vendedor consulta los pedidos de su catálogo.</p>
    <PendingReview>Determinar las bases del tratamiento y las responsabilidades de cada interviniente para cada finalidad.</PendingReview>
    <h2>Proveedores y comunicaciones</h2>
    <ul>
      <li>Supabase: PostgreSQL y Storage para datos e imágenes.</li>
      <li>Render: ejecución de la API.</li>
      <li>Vercel: frontend y proxy de la aplicación.</li>
      <li>Brevo: correos de verificación y recuperación de cuenta.</li>
      <li>Google: acceso con Google cuando el vendedor elige esa opción.</li>
      <li>WhatsApp: cuando el comprador decide abrirlo y enviar al vendedor el mensaje preparado con los datos del pedido. Registrar un pedido no demuestra que ese mensaje se haya enviado.</li>
    </ul>
    <PendingReview>Revisar contratos, localizaciones del tratamiento y transferencias internacionales. No se afirma una ubicación territorial de los datos no verificada.</PendingReview>
    <h2>Acceso a las cotizaciones</h2>
    <p>El enlace de cotización concede acceso al PDF a quien lo posea. Puede incluir datos personales del comprador y del vendedor: no es información exclusivamente privada del vendedor. Evita publicarlo. Cancelar el pedido revoca nuevas descargas, pero no elimina copias ya descargadas. Archivar el catálogo no revoca por sí mismo las cotizaciones existentes.</p>
    <h2>Conservación y supresión</h2>
    <p>No existe hoy un proceso automático de eliminación o anonimización de datos personales de pedidos, ni una opción de autoservicio para eliminar la cuenta o anonimizar un pedido. La referencia interna a doce meses es provisional, está pendiente de revisión y no se ejecuta automáticamente.</p>
    <p>Desactivar o archivar un catálogo retira su publicación, pero conserva sus datos e historial. Un catálogo con pedidos no puede borrarse. Sin pedidos puede borrarse mediante la opción disponible; esto no permite prometer una limpieza completa de los objetos de Storage. Quitar un logo elimina su referencia y solicita la eliminación del archivo anterior.</p>
    <PendingReview>Definir los plazos de conservación y el procedimiento de supresión, incluyendo pedidos, instantáneas, tokens, archivos, copias descargadas y respaldos. No se promete eliminación automática.</PendingReview>
    <h2>Cookies y almacenamiento del navegador</h2>
    <table><caption>Almacenamiento utilizado por la aplicación</caption><thead><tr><th scope="col">Elemento</th><th scope="col">Uso y duración técnica</th></tr></thead><tbody>
      <tr><th scope="row">Cookie catalogo_session</th><td>Autenticación. HttpOnly, SameSite=Lax y Secure en producción; máximo configurado de siete días. Cerrar sesión solicita su eliminación.</td></tr>
      <tr><th scope="row">localStorage: catalogo-session</th><td>ID, correo y nombre del vendedor para la interfaz. No contiene JWT ni autoriza ninguna operación. Sin caducidad propia; se elimina al cerrar sesión.</td></tr>
      <tr><th scope="row">sessionStorage: catalogo-cart-ID</th><td>Identificadores y cantidades del carrito por catálogo. Se limpia al registrar el pedido; normalmente finaliza con la sesión de la pestaña.</td></tr>
      <tr><th scope="row">sessionStorage: catalogo-template-ID</th><td>Plantilla recordada para el loading. Es una pista visual, no una fuente de verdad.</td></tr>
    </tbody></table>
    <p>No se ha identificado una integración explícita de analítica externa en el código revisado. Esto no acredita la configuración ni los registros de infraestructura. El acceso con Google utiliza un script externo; sus tratamientos y cookies requieren revisión.</p>
    <h2>Consultas y solicitudes sobre tus datos</h2>
    <p>Las consultas y solicitudes de privacidad se atienden por correo en <a href="mailto:vitrinaya983@gmail.com">vitrinaya983@gmail.com</a>. Todavía no existe un procedimiento formalizado.</p>
    <PendingReview>Precisar los derechos del titular, el procedimiento para ejercerlos, verificación de identidad y gestión de solicitudes. No se inventan plazos de respuesta.</PendingReview>
    <h2>Jurisdicción</h2>
    <PendingReview>Determinar la jurisdicción y las disposiciones aplicables tras revisión jurídica.</PendingReview>
  </LegalPage>;
}
