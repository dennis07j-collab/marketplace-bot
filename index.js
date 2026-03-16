const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const SHEETS_WEBHOOK_URL = process.env.SHEETS_WEBHOOK_URL;

const conversaciones = {};

const ESTADOS = {
  INICIO: "inicio",
  ESPERANDO_PRODUCTO: "esperando_producto",
  ESPERANDO_CANTIDAD: "esperando_cantidad",
  ESPERANDO_ENTREGA: "esperando_entrega",
  ESPERANDO_TELEFONO: "esperando_telefono",
  COMPLETADO: "completado",
};

// ============================================================
// PRODUCTOS Y PRECIOS
// ============================================================
const PRODUCTOS = {
  sobre: { nombre: "Sobre de Royal Honey", precio: 5.00, unidad: "sobre" },
  caja:  { nombre: "Caja de Royal Honey", precio: 50.00, unidad: "caja", detalle: "12 sobres" },
};

const ENTREGA = {
  costo: 4.95,
  gratis: {
    lugar: "Terminal Nuevo Amanecer Soyapango, Gasolinera Puma",
    horario: "Lunes a Viernes de 8am a 5pm",
  },
};

// ============================================================
// MENSAJES DEL BOT
// ============================================================
const MENSAJES = {
  bienvenida: (nombre) =>
    `¡Hola ${nombre}! 👋 Gracias por contactarnos. Tenemos disponible Royal Honey en dos presentaciones:\n\n` +
    `🍯 *Sobre individual* — $5.00 c/u\n` +
    `📦 *Caja completa* — $50.00 (12 sobres)\n\n` +
    `¿Te interesa el sobre o la caja?`,

  pedirCantidad: (tipo) => {
    if (tipo === "sobre") {
      return `¡Excelente elección! 🍯 Los sobres están a $5.00 c/u.\n¿Cuántos sobres te interesan?`;
    } else {
      return `¡Excelente elección! 📦 La caja tiene 12 sobres por $50.00.\n¿Cuántas cajas te interesan?`;
    }
  },

  mostrarTotal: (tipo, cantidad) => {
    const prod = PRODUCTOS[tipo];
    const subtotal = prod.precio * cantidad;
    const totalConEntrega = subtotal + ENTREGA.costo;
    return (
      `Perfecto! Tu pedido sería:\n\n` +
      `${cantidad} ${prod.unidad}${cantidad > 1 ? "s" : ""} de Royal Honey${tipo === "caja" ? ` (${prod.detalle} c/u)` : ""}\n` +
      `💰 Subtotal: $${subtotal.toFixed(2)}\n\n` +
      `📦 *Opciones de entrega:*\n\n` +
      `1️⃣ *Entrega a domicilio* — $${ENTREGA.costo} adicionales\n` +
      `   Total: $${totalConEntrega.toFixed(2)}\n` +
      `   (Cobertura todo San Salvador)\n\n` +
      `2️⃣ *Punto de entrega gratis* 🆓\n` +
      `   ${ENTREGA.gratis.lugar}\n` +
      `   🕐 ${ENTREGA.gratis.horario}\n\n` +
      `¿Prefieres entrega a domicilio o punto de entrega gratis?`
    );
  },

  pedirTelefono: (tipo_entrega) => {
    if (tipo_entrega === "domicilio") {
      return `¡Perfecto! Para coordinar la entrega a domicilio, ¿me puedes dar tu número de teléfono o WhatsApp?`;
    } else {
      return `¡Perfecto! Para coordinar la entrega en el punto, ¿me puedes dar tu número de teléfono o WhatsApp?`;
    }
  },

  despedida: (nombre, tipo, cantidad, entrega, telefono) => {
    const prod = PRODUCTOS[tipo];
    const subtotal = prod.precio * cantidad;
    const total = entrega === "domicilio" ? subtotal + ENTREGA.costo : subtotal;
    return (
      `¡Gracias ${nombre}! 😊 Tu pedido está registrado:\n\n` +
      `🍯 ${cantidad} ${prod.unidad}${cantidad > 1 ? "s" : ""} de Royal Honey\n` +
      `💰 Total: $${total.toFixed(2)}${entrega === "domicilio" ? " (incluye envío)" : ""}\n` +
      `📍 Entrega: ${entrega === "domicilio" ? "A domicilio" : "Punto de retiro gratis"}\n` +
      `📞 Tu número: ${telefono}\n\n` +
      `Nos comunicamos contigo muy pronto para confirmar y coordinar. ¡Que tengas un excelente día! 🌟`
    );
  },

  noEntendioProducto: () =>
    `Disculpa, no entendí bien. ¿Te interesa el *sobre* ($5.00) o la *caja* ($50.00 con 12 sobres)?`,

  noEntendioEntrega: () =>
    `Disculpa, ¿prefieres *domicilio* (con costo de $${ENTREGA.costo}) o *punto de entrega gratis* en Terminal Nuevo Amanecer?`,

  noEntendioNumero: () =>
    `Disculpa, ¿cuántas unidades necesitas? Escribe solo el número, por ejemplo: 2`,

  telefonoInvalido: () =>
    `Disculpa, no reconocí ese número. Por favor escribe tu número de teléfono, por ejemplo: 7823-4521`,
};
// ============================================================

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
      nombreFacebook: null,
      tipo: null,
      cantidad: null,
      entrega: null,
      telefono: null,
    };
  }

  const conv = conversaciones[senderId];

  // Paso 1: bienvenida y mostrar opciones
  if (conv.estado === ESTADOS.INICIO) {
    try {
      const perfil = await obtenerPerfil(senderId);
      conv.nombreFacebook = perfil.name || "Cliente";
    } catch {
      conv.nombreFacebook = "Cliente";
    }
    await enviarMensaje(senderId, MENSAJES.bienvenida(conv.nombreFacebook));
    conv.estado = ESTADOS.ESPERANDO_PRODUCTO;
    return;
  }

  // Paso 2: cliente elige sobre o caja
  if (conv.estado === ESTADOS.ESPERANDO_PRODUCTO) {
    const tipo = detectarProducto(texto);
    if (!tipo) {
      await enviarMensaje(senderId, MENSAJES.noEntendioProducto());
      return;
    }
    conv.tipo = tipo;
    await enviarMensaje(senderId, MENSAJES.pedirCantidad(tipo));
    conv.estado = ESTADOS.ESPERANDO_CANTIDAD;
    return;
  }

  // Paso 3: cliente da cantidad
  if (conv.estado === ESTADOS.ESPERANDO_CANTIDAD) {
    const cantidad = extraerNumero(texto);
    if (!cantidad) {
      await enviarMensaje(senderId, MENSAJES.noEntendioNumero());
      return;
    }
    conv.cantidad = cantidad;
    await enviarMensaje(senderId, MENSAJES.mostrarTotal(conv.tipo, cantidad));
    conv.estado = ESTADOS.ESPERANDO_ENTREGA;
    return;
  }

  // Paso 4: cliente elige tipo de entrega
  if (conv.estado === ESTADOS.ESPERANDO_ENTREGA) {
    const entrega = detectarEntrega(texto);
    if (!entrega) {
      await enviarMensaje(senderId, MENSAJES.noEntendioEntrega());
      return;
    }
    conv.entrega = entrega;
    await enviarMensaje(senderId, MENSAJES.pedirTelefono(entrega));
    conv.estado = ESTADOS.ESPERANDO_TELEFONO;
    return;
  }

  // Paso 5: cliente da teléfono
  if (conv.estado === ESTADOS.ESPERANDO_TELEFONO) {
    const telefono = extraerTelefono(texto);
    if (!telefono) {
      await enviarMensaje(senderId, MENSAJES.telefonoInvalido());
      return;
    }
    conv.telefono = telefono;

    await enviarMensaje(senderId, MENSAJES.despedida(
      conv.nombreFacebook, conv.tipo, conv.cantidad, conv.entrega, telefono
    ));

    const prod = PRODUCTOS[conv.tipo];
    const subtotal = prod.precio * conv.cantidad;
    const total = conv.entrega === "domicilio" ? subtotal + ENTREGA.costo : subtotal;

    await guardarLead({
      fecha: new Date().toLocaleDateString("es-SV"),
      nombre: conv.nombreFacebook,
      psid: senderId,
      producto: `${conv.cantidad} ${prod.unidad}${conv.cantidad > 1 ? "s" : ""} de Royal Honey`,
      tipo: conv.tipo,
      cantidad: conv.cantidad,
      entrega: conv.entrega === "domicilio" ? "Domicilio ($4.95)" : "Punto gratis (Terminal Nuevo Amanecer)",
      total: `$${total.toFixed(2)}`,
      telefono: telefono,
      estado: "Nuevo pedido",
    });

    console.log(`Pedido: ${conv.nombreFacebook} - ${conv.cantidad} ${conv.tipo}(s) - ${conv.entrega} - ${telefono}`);
    conv.estado = ESTADOS.COMPLETADO;
    setTimeout(() => delete conversaciones[senderId], 12 * 60 * 60 * 1000);
    return;
  }

  // Si ya completó
  if (conv.estado === ESTADOS.COMPLETADO) {
    await enviarMensaje(
      senderId,
      "¡Hola de nuevo! Ya tenemos tu pedido registrado. Pronto nos comunicamos contigo para coordinar. 😊"
    );
  }
}

// ---- Helpers ----

function detectarProducto(texto) {
  const lower = texto.toLowerCase();
  if (lower.includes("caja") || lower.includes("2") && lower.includes("50")) return "caja";
  if (lower.includes("sobre") || lower.includes("1") || lower.includes("individual")) return "sobre";
  // Si escribe solo "1" o "2"
  if (texto.trim() === "1") return "sobre";
  if (texto.trim() === "2") return "caja";
  return null;
}

function detectarEntrega(texto) {
  const lower = texto.toLowerCase();
  if (lower.includes("domicilio") || lower.includes("1") || lower.includes("envío") || lower.includes("envio") || lower.includes("casa")) return "domicilio";
  if (lower.includes("gratis") || lower.includes("2") || lower.includes("punto") || lower.includes("terminal") || lower.includes("soyapango") || lower.includes("puma") || lower.includes("recoger") || lower.includes("retiro")) return "gratis";
  if (texto.trim() === "1") return "domicilio";
  if (texto.trim() === "2") return "gratis";
  return null;
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

function extraerTelefono(texto) {
  // Limpiar espacios, guiones, signos
  const limpio = texto.replace(/[\s\-\+\(\)]/g, "");
  // Extraer solo dígitos
  const digitos = limpio.replace(/[^0-9]/g, "");
  // Aceptar cualquier número de 8 dígitos (con o sin prefijo 503)
  if (digitos.length === 11 && digitos.startsWith("503")) return digitos.slice(3);
  if (digitos.length === 8) return digitos;
  if (digitos.length > 8) return digitos.slice(-8);
  return null;
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
    const params = new URLSearchParams({
      fecha:    data.fecha    || "",
      nombre:   data.nombre   || "",
      producto: data.producto || "",
      cantidad: String(data.cantidad || ""),
      tipo:     data.tipo     || "",
      entrega:  data.entrega  || "",
      total:    data.total    || "",
      telefono: data.telefono || "",
      estado:   data.estado   || "Nuevo pedido",
    });
    await axios.get(SHEETS_WEBHOOK_URL + "?" + params.toString());
    console.log("Lead guardado en Sheets correctamente");
  } catch (err) {
    console.error("Error guardando en Sheets:", err.message);
  }
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Bot Royal Honey corriendo en puerto ${PORT}`));

