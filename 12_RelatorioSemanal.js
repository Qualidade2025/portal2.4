/** =========================================================
 * Relatório semanal de RNCs por responsável/supervisor
 * ========================================================= */

function _parseSheetDate_(value) {
  if (value instanceof Date && !isNaN(value)) return value;
  if (typeof value === 'number') {
    var base = new Date(1899, 11, 30);
    return new Date(base.getTime() + value * 24 * 3600 * 1000);
  }
  if (!value) return null;
  var parsed = new Date(value);
  return isNaN(parsed) ? null : parsed;
}

function _formatDate_(value, tz) {
  var dt = _parseSheetDate_(value);
  if (!dt) return '';
  return Utilities.formatDate(dt, tz, 'dd/MM/yyyy');
}

function _isValidEmail_(value) {
  var email = String(value || '').trim();
  if (!email) return false;
  // Validação simples apenas para evitar valores óbvios inválidos como IDs numéricos.
  return email.indexOf('@') !== -1 && email.indexOf('.') !== -1;
}

function _getSupervisorEmailMap_() {
  var sh = SpreadsheetApp.getActive().getSheetByName('Dados');
  if (!sh) throw new Error('Aba "Dados" não encontrada.');

  var data = sh.getDataRange().getValues();
  var hdrIdx = -1, cSup = -1, cEmail = -1;

  for (var i = 0; i < data.length; i++) {
    var row = data[i].map(function (x) { return String(x || '').trim(); });
    var lower = row.map(function (x) { return x.toLowerCase(); });
    if (hdrIdx === -1) {
      cSup = lower.indexOf('supervisor');
      cEmail = lower.indexOf('email');
      if (cSup !== -1) hdrIdx = i;
    }
    if (hdrIdx !== -1) break;
  }

  if (hdrIdx === -1 || cSup === -1) return {};
  if (cEmail === -1 && data[hdrIdx].length > 9) cEmail = 9; // Coluna J

  var map = {};
  for (var r = hdrIdx + 1; r < data.length; r++) {
    var sup = String(data[r][cSup] || '').trim();
    if (!sup) continue;
    var email = (cEmail >= 0 && data[r].length > cEmail) ? String(data[r][cEmail] || '').trim() : '';
    if (_isValidEmail_(email)) {
      map[sup] = email;
    } else if (cEmail === -1 && _isValidEmail_(sup)) {
      // Se não há coluna de e-mail, use o próprio supervisor se ele já for um e-mail
      map[sup] = sup;
    } else {
      map[sup] = '';
    }
  }
  return map;
}

function _getPlatformLink_() {
  var sh = SpreadsheetApp.getActive().getSheetByName('Dados');
  if (!sh) return '';

  var link = sh.getRange('B4').getValue();
  return String(link || '').trim();
}

function gerarRelatorioSemanalPorResponsavel() {
  var sh = SpreadsheetApp.getActive().getSheetByName('Controle');
  if (!sh) throw new Error('Aba "Controle" não encontrada.');

  var vals = sh.getDataRange().getValues();
  if (vals.length < 2) return {};

  var cols = _getControleColumnIndices_(sh);
  var tz = Session.getScriptTimeZone() || 'America/Sao_Paulo';
  var hoje = new Date();
  var semanaAtras = new Date(hoje.getTime() - 7 * 24 * 3600 * 1000);
  var supervisorEmails = _getSupervisorEmailMap_();
  var relatorios = {};

  function ensure(destinatario) {
    var nome = String(destinatario || '').trim();
    if (!nome) return null;

    var email = supervisorEmails[nome];
    if (!email && _isValidEmail_(nome)) email = nome; // dest já é e-mail
    if (!_isValidEmail_(email)) return null; // Ignora IDs ou textos sem e-mail

    if (!relatorios[nome]) {
      relatorios[nome] = {
        nome: nome,
        email: email,
        pendentes: [],
        fechadasSemana: [],
        prazosProximos: [],
        atrasadas: [],
        aguardandoValidacao: 0
      };
    }
    return relatorios[nome];
  }

  for (var r = 1; r < vals.length; r++) {
    var row = vals[r];
    var rnc = String(row[cols.rnc.index] || '').trim();
    if (!rnc) continue;

    var etapa = String(row[cols.etapa.index] || '').trim();
    var statusResposta = String(row[cols.statusResposta.index] || '').trim();
    var statusConclusaoPlano = String(row[cols.statusConclusaoPlano.index] || '').trim();
    var statusEtapa = String(row[cols.status.index] || '').trim();
    var cliente = String(row[cols.cliente.index] || '').trim();
    var fornecedor = String(row[cols.fornecedor.index] || '').trim();
    var respForn = String(row[cols.responsavelFornecimento.index] || '').trim();
    var respPa = String(row[cols.responsavelPa.index] || '').trim();
    var corSla = String(row[cols.cor.index] || '').trim();

    var prazoControle = _parseSheetDate_(row[cols.prazoControle.index]);

    var prazoPa = _parseSheetDate_(row[cols.prazoPa.index]);
    var prazoResp = _parseSheetDate_(row[cols.prazoResposta.index]);
    var prazoReferencia = prazoControle || prazoPa || prazoResp;
    var diasParaPrazo = prazoReferencia ? Math.floor((prazoReferencia.getTime() - hoje.getTime()) / (24 * 3600 * 1000)) : null;

    var dataConclusao = _parseSheetDate_(row[cols.dataConclusao.index]);
    var revisaoEficacia = _parseSheetDate_(row[cols.revisaoEficacia.index]);

    var etapaValor = statusEtapa;
    var etapaLower = etapaValor.toLowerCase();

    // Regras específicas para status de conclusão do plano (coluna U)
    var aguardandoValidacao = etapaLower.indexOf('aguardando valida') !== -1;
    if (aguardandoValidacao) {
      continue;
    }
    var pendentePorStatus = etapaLower.indexOf('aguardando resposta') !== -1 || etapaLower.indexOf('aguardando corre') !== -1 || etapaLower.indexOf('aguardando conclus') !== -1;
    var aguardandoCorrecaoConclusao = etapaLower.indexOf('aguardando corre') !== -1 || etapaLower.indexOf('correcao de conclus') !== -1;
    var finalizadoPorStatus = etapaLower.indexOf('finalizado') !== -1;
    var isConcluida = !aguardandoCorrecaoConclusao && (finalizadoPorStatus || etapaLower.indexOf('conclus') !== -1 || etapaLower.indexOf('valida') !== -1);
    var pendente = pendentePorStatus || (!finalizadoPorStatus && !isConcluida);
    var fechadaSemana = (dataConclusao && dataConclusao >= semanaAtras && dataConclusao <= hoje) || (revisaoEficacia && revisaoEficacia >= semanaAtras && revisaoEficacia <= hoje);
    var prazoProximo = pendente && diasParaPrazo !== null && diasParaPrazo >= 0 && diasParaPrazo <= 7;
    var atrasada = pendente && diasParaPrazo !== null && diasParaPrazo < 0;

    var itemBase = {
      rnc: rnc,
      etapa: etapaValor,
      statusResposta: statusResposta,
      statusPlano: statusConclusaoPlano,
      cliente: cliente,
      fornecedor: fornecedor,
      prazoControle: _formatDate_(prazoControle, tz),
      prazoPa: _formatDate_(prazoPa, tz),
      prazoResposta: _formatDate_(prazoResp, tz),
      dataConclusao: _formatDate_(dataConclusao, tz),
      revisaoEficacia: _formatDate_(revisaoEficacia, tz),
      diasParaPrazo: diasParaPrazo,
      corSla: corSla
    };

     var destinatarios = [respForn, respPa]
      .map(function (email) { return String(email || '').trim(); })
      .filter(function (email) { return !!email; })
      .filter(function (email, index, arr) { return arr.indexOf(email) === index; });
    for (var d = 0; d < destinatarios.length; d++) {
      var dest = ensure(destinatarios[d]);
      if (!dest) continue;

      var aguardandoValidacao = etapaLower.indexOf('valida') !== -1;
      if (aguardandoValidacao && !finalizadoPorStatus) {
        dest.aguardandoValidacao += 1;
        continue;
      }

      if (pendente && !finalizadoPorStatus) dest.pendentes.push(itemBase);
      if (!aguardandoCorrecaoConclusao && fechadaSemana) dest.fechadasSemana.push(itemBase);
      if (prazoProximo) dest.prazosProximos.push(itemBase);
      if (atrasada) dest.atrasadas.push(itemBase);
    }
  }

  return relatorios;
}

function enviarRelatorioSemanal() {
  var relatorios = gerarRelatorioSemanalPorResponsavel();
  var hoje = new Date();
  var tz = Session.getScriptTimeZone() || 'America/Sao_Paulo';
  var dataAssunto = Utilities.formatDate(hoje, tz, 'dd/MM/yyyy');
  var platformLink = _getPlatformLink_();

  var envios = [];
  var destinatarios = Object.keys(relatorios);
  for (var i = 0; i < destinatarios.length; i++) {
    var destKey = destinatarios[i];
    var info = relatorios[destKey];
    if (!info || !info.email) continue;

    var assunto = 'Relatório semanal de RNCs – ' + info.nome + ' – ' + dataAssunto;
    var html = _buildRelatorioHtml_(info, tz, platformLink);
    var texto = 'Resumo semanal de RNCs. Visualize em HTML se disponível.';

    MailApp.sendEmail({
      to: info.email,
      subject: assunto,
      htmlBody: html,
      body: texto
    });

    envios.push({ destinatario: info.email, pendentes: info.pendentes.length, fechadas: info.fechadasSemana.length });
  }

  return { totalDestinatarios: envios.length, envios: envios };
}

function _buildRelatorioHtml_(info, tz, platformLink) {
  function esc(val) {
    return String(val == null ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function buildPendenciasTable(items) {
    if (!items || !items.length) return '';

    var sorted = items.slice().sort(function (a, b) {
      var da = (a.diasParaPrazo === null || typeof a.diasParaPrazo === 'undefined') ? Number.POSITIVE_INFINITY : a.diasParaPrazo;
      var db = (b.diasParaPrazo === null || typeof b.diasParaPrazo === 'undefined') ? Number.POSITIVE_INFINITY : b.diasParaPrazo;
      return da - db;
    });

    var rows = sorted.map(function (item) {
      var prazo = item.prazoControle || '';
      var dias = (item.diasParaPrazo === null || typeof item.diasParaPrazo === 'undefined') ? '' : item.diasParaPrazo + 'd';
      var corBase = String(item.corSla || '').toLowerCase();
      var situacao = corBase.indexOf('vermelho') !== -1 ? 'Atrasada' : 'No prazo';
      var situacaoCor = corBase.indexOf('vermelho') !== -1 ? '#d73a49' : '#22863a';

      return '<tr>' +
        '<td style="border:1px solid #ccc; padding:6px;">' + esc(item.rnc) + '</td>' +
        '<td style="border:1px solid #ccc; padding:6px;">' + esc(item.etapa) + '</td>' +
        '<td style="border:1px solid #ccc; padding:6px;">' + esc(item.cliente || '') + '</td>' +
        '<td style="border:1px solid #ccc; padding:6px;">' + esc(item.fornecedor || '') + '</td>' +
        '<td style="border:1px solid #ccc; padding:6px;">' + esc(prazo) + '</td>' +
        '<td style="border:1px solid #ccc; padding:6px;">' + esc(dias) + '</td>' +
        '<td style="border:1px solid #ccc; padding:6px; color:' + situacaoCor + '; font-weight:bold;">' + esc(situacao) + '</td>' +
        '</tr>';
    }).join('');

    return ['<h4>Pendências</h4>',
      '<table style="border-collapse:collapse; width:100%;">',
      '<thead><tr>',
      '<th style="border:1px solid #ccc; padding:6px;">RNC</th>',
      '<th style="border:1px solid #ccc; padding:6px;">Etapa</th>',
      '<th style="border:1px solid #ccc; padding:6px;">Cliente</th>',
      '<th style="border:1px solid #ccc; padding:6px;">Fornecedor</th>',
      '<th style="border:1px solid #ccc; padding:6px;">Prazo</th>',
      '<th style="border:1px solid #ccc; padding:6px;">Dias</th>',
      '<th style="border:1px solid #ccc; padding:6px;">Situação</th>',
      '</tr></thead>',
      '<tbody>', rows, '</tbody></table>'
    ].join('');
  }

  function buildConcluidasTable(items) {
    if (!items || !items.length) return '';

    var rows = items.map(function (item) {
      var situacao = item.statusResposta || '';
      var etapa = situacao ? (item.etapa + ' - ' + situacao) : item.etapa;
      return '<tr>' +
        '<td style="border:1px solid #ccc; padding:6px;">' + esc(item.rnc) + '</td>' +
        '<td style="border:1px solid #ccc; padding:6px;">' + esc(etapa) + '</td>' +
        '<td style="border:1px solid #ccc; padding:6px;">' + esc(item.cliente || '') + '</td>' +
        '<td style="border:1px solid #ccc; padding:6px;">' + esc(item.fornecedor || '') + '</td>' +
        '</tr>';
    }).join('');

    return ['<h4>RNCs concluídas</h4>',
      '<table style="border-collapse:collapse; width:100%;">',
      '<thead><tr>',
      '<th style="border:1px solid #ccc; padding:6px;">RNC</th>',
      '<th style="border:1px solid #ccc; padding:6px;">Etapa</th>',
      '<th style="border:1px solid #ccc; padding:6px;">Cliente</th>',
      '<th style="border:1px solid #ccc; padding:6px;">Fornecedor</th>',
      '</tr></thead>',
      '<tbody>', rows, '</tbody></table>'
    ].join('');
  }

  var pendentesNoPrazo = info.pendentes.filter(function (item) {
    return info.atrasadas.indexOf(item) === -1;
  });

  var resumoStatus = [
    '<p style="margin:4px 0;"><strong>No prazo:</strong> <span style="color:#22863a; font-weight:bold;">' + pendentesNoPrazo.length + '</span></p>',
    '<p style="margin:4px 0;"><strong>Atrasadas:</strong> <span style="color:#d73a49; font-weight:bold;">' + info.atrasadas.length + '</span></p>',
    '<p style="margin:4px 0;"><strong>Próximos 7 dias:</strong> ' + info.prazosProximos.length + '</p>',
    '<p style="margin:4px 0;"><strong>Concluídas na semana:</strong> ' + info.fechadasSemana.length + '</p>'
  ].join('');

  var sectionsList = [
    buildPendenciasTable(info.pendentes),
    buildConcluidasTable(info.fechadasSemana)
  ].filter(function (section) { return section; });

  var sections = sectionsList.join('<br/>');

  var espacoRodape = '<br/><br/><br/><br/><br/>';

  var linkAcesso = platformLink ? '<p style="margin:8px 0;"><a href="' + esc(platformLink) + '" style="color:#0366d6; font-weight:bold;" target="_blank" rel="noopener">Acessar a plataforma</a></p>' : '';
  var naoResponderMsg = '<p style="color:#888; font-size:12px; margin:4px 0;">Este e-mail não aceita respostas. Se necessário enviar para controle.qualidade@estojosbaldi.com.br</p>';
  var geracaoMsg = '<p style="color:#888; font-size:12px;">Relatório gerado automaticamente em ' + Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm') + '.</p>';

  return ['<div style="font-family:Arial, sans-serif; font-size:13px;">',
    '<h3 style="text-align:center;">Relatório semanal de RNCs - ' + esc(info.nome) + '</h3>',
    resumoStatus,
    sections,
    espacoRodape,
    linkAcesso,
    naoResponderMsg,
    geracaoMsg,
    '</div>'].join('');
}

function criarGatilhoRelatorioSemanal() {
  var handler = 'enviarRelatorioSemanal';
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction && triggers[i].getHandlerFunction() === handler) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger(handler).timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  return 'Gatilho semanal criado para a função "' + handler + '" (segunda-feira às 08h).';
}