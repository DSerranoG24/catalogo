import LegalPage from "@/components/legal/LegalPage";
import ContactDraftForm from "@/components/legal/ContactDraftForm";
import { legalMetadata } from "@/lib/legal-metadata";

export const metadata = legalMetadata("/contacto", "Contacto", "Contacta con Vitrinaya para consultas, soporte, incidencias y solicitudes de privacidad. Prepara un borrador de correo sin envío automático.");

export default function ContactPage() {
  return <LegalPage title="Contacto">
    <p>Escríbenos para consultas, soporte e incidencias relacionadas con Vitrinaya, o para solicitudes sobre tus datos.</p>
    <ul>
      <li>Correo: <a href="mailto:vitrinaya983@gmail.com">vitrinaya983@gmail.com</a></li>
      <li><a href="https://www.instagram.com/vitrinaya.app/">Instagram de Vitrinaya</a></li>
      <li><a href="https://www.facebook.com/profile.php?id=61595710178606">Facebook de Vitrinaya</a></li>
    </ul>
    <h2>Preparar una consulta por correo</h2>
    <ContactDraftForm />
    <p>Si tu aplicación no admite archivos .eml, utiliza el <a href="mailto:vitrinaya983@gmail.com">correo directo a Vitrinaya</a>. No incluyas contraseñas ni información personal innecesaria.</p>
    <h2>Solicitudes de privacidad</h2>
    <p>Se atienden en el mismo correo. Consulta la <a href="/privacidad">política de privacidad y sus secciones pendientes de revisión jurídica</a>.</p>
  </LegalPage>;
}
