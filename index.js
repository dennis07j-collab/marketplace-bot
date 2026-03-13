const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const SHEETS_WEBHOOK_URL = process.env.SHEETS_WEBHOOK_URL;

// Memoria temporal de conversaciones
const conversaciones = {};

const ESTADOS = {
  INICIO: "inicio",
  ESPERANDO_UNIDADES: "esperando_unidades",
  ESPERANDO_NOMBRE: "esperando_nombre",
  COMPLETADO: "completado",
};

// ============================================================
// MENSAJES DEL BOT — edítalos como quieras
// ============================================================
const MENSAJES = {
  bienvenida: (nombre) =>
    `¡Hola ${nombre}! 👋 Sí tenemos disponibilidad. ¿Cuántas unidades te interesan?`,

  confirmarUnidades: (unidades) =>
    `Perfecto, anotado: ${unidades} unidad${unidades > 1 ? "es" : ""}. ¿Me puedes dar tu nombre para coordinar contigo?`,

  despedida: (nombre) =>
    `¡Gracias ${nombre}! 😊 Revisamos tu solicitud y nos comunicamos contigo muy pronto.`,

  noEntendi: () =>
    `Disculpa, no entendí bien. ¿Cuántas unidades necesitas? Escribe solo el número, por ejemplo: 2`,
};
// ============================================================

// Verificación del webhook
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Recibir mensajes
app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (body.object !== "page") return res.sendStatus(404);

  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      if (!event.message || event.message.is_echo) continue;
      const senderId = event.sender.id;
      const texto = (event.message.text || "").trim();
      try {
        await procesarMensaje(senderId, texto);
      } catch (err) {
        console.error("Error:", err.message);
      }
    }
  }

  res.status(200).send("EVENT_RECEIVED");
});

async function procesarMensaje(senderId, texto) {
  if (!conversaciones[senderId]) {
    conversaciones[senderId] = {
      estado: ESTADOS.INICIO,
      nombre: null,
      unidades: null,
      nombreFacebook: null,
    };
  }

  const conv = conversaciones[senderId];

  // Paso 1: primer mensaje — saludar y preguntar unidades
  if (conv.estado === ESTADOS.INICIO) {
    try {
      const perfil = await obtenerPerfil(senderId);
      conv.nombreFacebook = perfil.name || "Cliente";
    } catch {
      conv.nombreFacebook = "Cliente";
    }
    await enviarMensaje(senderId, MENSAJES.bienvenida(conv.nombreFacebook));
    conv.estado = ESTADOS.ESPERANDO_UNIDADES;
    return;
  }

  // Paso 2: cliente responde cuántas unidades
  if (conv.estado === ESTADOS.ESPERANDO_UNIDADES) {
    const unidades = extraerNumero(texto);
    if (!unidades) {
      await enviarMensaje(senderId, MENSAJES.noEntendi());
      return;
    }
    conv.unidades = unidades;
    await enviarMensaje(senderId, MENSAJES.confirmarUnidades(unidades));
    conv.estado = ESTADOS.ESPERANDO_NOMBRE;
    return;
  }

  // Paso 3: cliente da su nombre
  if (conv.estado === ESTADOS.ESPERANDO_NOMBRE) {
    const nombreCliente = texto.length > 1 ? capitalizar(texto) : conv.nombreFacebook;
    conv.nombre = nombreCliente;

    await enviarMensaje(senderId, MENSAJES.despedida(nombreCliente));

    await guardarLead({
      fecha: new Date().toLocaleDateString("es-SV"),
      nombre: nombreCliente,
      nombre_facebook: conv.nombreFacebook,
      psid: senderId,
      unidades: conv.unidades,
      estado: "Nuevo lead",
      notas: `Interesado en ${conv.unidades} unidad${conv.unidades > 1 ? "es" : ""}`,
    });

    console.log(`Lead guardado: ${nombreCliente} - ${conv.unidades} unidades`);
    conv.estado = ESTADOS.COMPLETADO;

    // Reiniciar conversación después de 12 horas
    setTimeout(() => delete conversaciones[senderId], 12 * 60 * 60 * 1000);
    return;
  }

  // Si ya completó el flujo
  if (conv.estado === ESTADOS.COMPLETADO) {
    await enviarMensaje(
      senderId,
      "¡Hola de nuevo! Ya tenemos tu solicitud registrada. Pronto nos comunicamos contigo."
    );
  }
}

function extraerNumero(texto) {
  const palabras = {
    uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
    seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  };
  const num = parseInt(texto.replace(/[^0-9]/g, ""), 10);
  if (!isNaN(num) && num > 0) return num;
  const lower = texto.toLowerCase();
  for (const [palabra, valor] of Object.entries(palabras)) {
    if (lower.includes(palabra)) return valor;
  }
  return null;
}

function capitalizar(str) {
  return str.toLowerCase().split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

async function obtenerPerfil(senderId) {
  const res = await axios.get(`https://graph.facebook.com/${senderId}`, {
    params: { fields: "name", access_token: PAGE_ACCESS_TOKEN },
  });
  return res.data;
}

async function enviarMensaje(recipientId, texto) {
  await axios.post(
    "https://graph.facebook.com/v18.0/me/messages",
    { recipient: { id: recipientId }, message: { text: texto } },
    { params: { access_token: PAGE_ACCESS_TOKEN } }
  );
}

async function guardarLead(data) {
  if (!SHEETS_WEBHOOK_URL) return;
  try {
    await axios.post(SHEETS_WEBHOOK_URL, data);
  } catch (err) {
    console.error("Error guardando en Sheets:", err.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot corriendo en puerto ${PORT}`));
