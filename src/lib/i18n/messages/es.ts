import type { Messages } from "./en";

export const es = {
  "common.unexpectedError": "Algo salió mal por nuestra parte. Inténtalo de nuevo.",
  "common.goToConsole": "Ir a la consola",
  "common.tryAgain": "Intentar de nuevo",

  "language.label": "Idioma",
  "language.current": "Idioma: {language}",

  "env.development": "Desarrollo",
  "env.staging": "Pruebas",
  "env.production": "Producción",

  "shell.brandSubtitle": "Business Console",
  "shell.nav": "Consola",
  "shell.openMenu": "Abrir menú",
  "shell.menu": "Menú",
  "shell.menuDescription": "Secciones de la consola",
  "shell.account": "Cuenta: {email}",
  "shell.signedInAs": "Sesión iniciada como",
  "shell.signOut": "Cerrar sesión",

  "nav.dashboard": "Panel",
  "nav.customers": "Clientes",
  "nav.crm": "CRM",
  "nav.users": "Usuarios",
  "nav.households": "Hogares",
  "nav.operations": "Operaciones",
  "nav.support": "Soporte",
  "nav.deletions": "Solicitudes de eliminación",
  "nav.payouts": "Pagos",
  "nav.ai": "Uso de IA",
  "nav.billing": "Suscripciones",
  "nav.plans": "Planes",
  "nav.revenue": "Ingresos",
  "nav.admin": "Administración",
  "nav.team": "Equipo",
  "nav.switches": "Interruptores globales",
  "nav.audit": "Registro de auditoría",

  "root.notFoundTitle": "Página no encontrada",
  "root.notFoundBody": "No hay ninguna página en esta dirección de la consola.",
  "root.errorTitle": "Esta página no se cargó",
  "root.errorBody": "Algo salió mal por nuestra parte. Inténtalo de nuevo o vuelve a la consola.",

  "refresh.loaded": "Cargado {time}",
  "refresh.refresh": "Actualizar",
  "refresh.refreshing": "Actualizando",

  "list.noRows": "Sin filas",
  "list.showing": "Mostrando 1 a {shown} de {total}",
  "list.previous": "Anterior",
  "list.previousPage": "Página anterior",
  "list.next": "Siguiente",
  "list.nextPage": "Página siguiente",
  "list.page": "Página {page}",

  "states.unavailable": "No disponible",
  "states.restricted": "Restringido",
  "states.notCovered": "Tu rol no incluye esta pantalla.",
  "states.askAdmin": "Pídeselo a un administrador si lo necesitas.",
  "states.goToDashboard": "Ir al panel",

  "export.csv": "Exportar CSV",
  "export.notRecorded":
    "No se pudo registrar la exportación, así que no se realizó. Inténtalo de nuevo.",
  "export.downloaded": "CSV descargado",
  "export.downloadedOne": "{name}, 1 fila. Sin nombres ni datos de contacto.",
  "export.downloadedMany": "{name}, {count} filas. Sin nombres ni datos de contacto.",

  "form.choose": "Elegir",
  "form.working": "Procesando",
  "form.cancel": "Cancelar",

  "hidden.hidden": "Oculto",
  "hidden.notSet": "Sin definir",
  "hidden.show": "Mostrar",
  "hidden.showing": "Mostrando",

  "charts.chart": "Gráfico",
  "charts.table": "Tabla",

  "auth.workEmail": "Correo de trabajo",
  "auth.password": "Contraseña",
  "auth.backToSignIn": "Volver a iniciar sesión",
  "auth.checking": "Comprobando",
  "auth.codeLabel": "Tu código de verificación en dos pasos",
  "auth.codeHint": "El código de 6 dígitos de tu app de autenticación.",

  "signIn.title": "Inicia sesión en Business Console",
  "signIn.description":
    "Usa tu correo de trabajo de la consola. Las cuentas de hogar no pueden iniciar sesión aquí.",
  "signIn.forgot": "¿Olvidaste tu contraseña?",
  "signIn.signingIn": "Iniciando sesión",
  "signIn.continue": "Continuar",

  "twoStep.title": "Introduce tu código",
  "twoStep.description":
    "Abre tu app de autenticación e introduce el código que muestra para Linara Business Console.",
  "twoStep.otherAccount": "Usar otra cuenta",
  "twoStep.signIn": "Iniciar sesión",
  "twoStep.lostPhone":
    "¿Perdiste tu teléfono? Pide a otro administrador que restablezca tu verificación en dos pasos.",

  "setUp.title": "Configura la verificación en dos pasos",
  "setUp.description":
    "Cada administrador inicia sesión con una contraseña y un código de su teléfono. Tarda alrededor de un minuto.",
  "setUp.install":
    "Instala una app de autenticación en tu teléfono, como Google Authenticator o Microsoft Authenticator.",
  "setUp.scan": "Escanea este código con la app.",
  "setUp.qrAlt": "Código QR para tu app de autenticación",
  "setUp.qrLoading": "Cargando el código QR",
  "setUp.cantScan": "¿No puedes escanearlo? Introduce esta clave:",
  "setUp.enterCode": "Introduce el código que muestra la app.",
  "setUp.turnOn": "Activar la verificación en dos pasos",

  "forgot.title": "Restablece tu contraseña",
  "forgot.description":
    "Introduce tu correo de trabajo de la consola y te enviaremos un enlace para restablecerla.",
  "forgot.sent":
    "Si {email} tiene una cuenta en la consola, el enlace va en camino. Funciona una sola vez y solo en esta consola.",
  "forgot.sending": "Enviando",
  "forgot.send": "Enviar enlace",

  "setPassword.inviteTitle": "Te damos la bienvenida a Business Console",
  "setPassword.recoveryTitle": "Elige una contraseña nueva",
  "setPassword.inviteDescription":
    "Elige una contraseña para tu cuenta de la consola. Después configurarás la verificación en dos pasos.",
  "setPassword.recoveryDescription": "Elige una contraseña nueva para tu cuenta de la consola.",
  "setPassword.mismatch": "Las dos contraseñas no coinciden.",
  "setPassword.changed": "Contraseña cambiada. Inicia sesión con ella ahora.",
  "setPassword.newLink": "Pedir un enlace nuevo",
  "setPassword.expired": "Este enlace caducó o ya se usó. Pide uno nuevo.",
  "setPassword.new": "Contraseña nueva",
  "setPassword.minLength": "Al menos 12 caracteres.",
  "setPassword.again": "Escríbela de nuevo",
  "setPassword.saving": "Guardando",
  "setPassword.saveContinue": "Guardar y continuar",
  "setPassword.save": "Guardar contraseña",
} satisfies Messages;
