// =====================================================
// INSTRUCCIONES:
// 1. Abre tu Google Sheet
// 2. Ve a Extensiones → Apps Script
// 3. Borra todo el código existente
// 4. Pega ESTE código completo
// 5. Clic en Implementar → Nueva implementación
// 6. Tipo: Aplicación web
// 7. Ejecutar como: Tú mismo
// 8. Acceso: Cualquier usuario
// 9. Implementar → Copia la URL que aparece
// =====================================================

function doPost(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    
    // Verificar que existan los encabezados, si no crearlos
    const firstRow = sheet.getRange(1, 1, 1, 8).getValues()[0];
    if (!firstRow[0]) {
      sheet.getRange(1, 1, 1, 8).setValues([[
        "Fecha", "Nombre", "PSID", "Mensaje", "Producto", "Prioridad", "Respondido", "Notas"
      ]]);
      // Formatear encabezados
      sheet.getRange(1, 1, 1, 8).setBackground("#1a73e8").setFontColor("#ffffff").setFontWeight("bold");
      sheet.setFrozenRows(1);
    }

    // Parsear datos recibidos del bot
    const data = JSON.parse(e.postData.contents);

    // Agregar nueva fila con los datos del lead
    sheet.appendRow([
      data.fecha || new Date().toLocaleDateString("es-SV"),
      data.nombre || "Desconocido",
      data.psid || "",
      data.mensaje || "",
      data.producto || "No especificado",
      data.prioridad || "Baja",
      data.respondido || "Sí",
      data.notas || ""
    ]);

    // Colorear según prioridad
    const lastRow = sheet.getLastRow();
    const prioridadCell = sheet.getRange(lastRow, 6);
    if (data.prioridad === "Alta") {
      prioridadCell.setBackground("#fce8e6").setFontColor("#c5221f");
    } else if (data.prioridad === "Media") {
      prioridadCell.setBackground("#fef9e7").setFontColor("#7b5700");
    } else {
      prioridadCell.setBackground("#e6f4ea").setFontColor("#137333");
    }

    return ContentService
      .createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Función de prueba - ejecuta esta para verificar que funciona
function testSave() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sheet.appendRow([
    new Date().toLocaleDateString("es-SV"),
    "Cliente de Prueba",
    "123456789",
    "¿Está disponible el sofá?",
    "sofá",
    "Alta",
    "Sí",
    "Lead de prueba"
  ]);
  Logger.log("Fila de prueba agregada correctamente");
}
