import { Controller, Get, Post, Delete, Param, Body, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { SessionService } from './session.service';
import { CreateSessionDto, SessionResponseDto, QRCodeResponseDto } from './dto';
import { Session } from './entities/session.entity';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

@ApiTags('sessions')
@Controller('sessions')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  private transformSession(session: Session): SessionResponseDto {
    return {
      id: session.id,
      name: session.name,
      status: session.status,
      phone: session.phone,
      pushName: session.pushName,
      connectedAt: session.connectedAt,
      lastActive: session.lastActiveAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  @Post()
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Create a new WhatsApp session' })
  @ApiResponse({ status: 201, description: 'Session created', type: SessionResponseDto })
  @ApiResponse({ status: 409, description: 'Session name already exists' })
  async create(@Body() dto: CreateSessionDto): Promise<Session> {
    return this.sessionService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all sessions' })
  @ApiResponse({ status: 200, description: 'List of sessions', type: [SessionResponseDto] })
  async findAll(): Promise<SessionResponseDto[]> {
    const sessions = await this.sessionService.findAll();
    return sessions.map(s => this.transformSession(s));
  }

  @Get('stats/overview')
  @ApiOperation({ summary: 'Get session statistics for multi-session monitoring' })
  @ApiResponse({ status: 200, description: 'Session statistics' })
  async getStats(): Promise<{
    total: number;
    active: number;
    ready: number;
    disconnected: number;
    byStatus: Record<string, number>;
    memoryUsage: { heapUsed: number; heapTotal: number; rss: number };
  }> {
    return this.sessionService.getStats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get session by ID' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Session details', type: SessionResponseDto })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async findOne(@Param('id') id: string): Promise<SessionResponseDto> {
    const session = await this.sessionService.findOne(id);
    return this.transformSession(session);
  }

  @Delete(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a session' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 204, description: 'Session deleted' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async delete(@Param('id') id: string): Promise<void> {
    await this.sessionService.delete(id);
  }

  @Post(':id/start')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Start a session and initialize WhatsApp connection' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Session started', type: SessionResponseDto })
  @ApiResponse({ status: 400, description: 'Session already started' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async start(@Param('id') id: string): Promise<SessionResponseDto> {
    const session = await this.sessionService.start(id);
    return this.transformSession(session);
  }

  @Post(':id/stop')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Stop a session and disconnect WhatsApp' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Session stopped', type: SessionResponseDto })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async stop(@Param('id') id: string): Promise<SessionResponseDto> {
    const session = await this.sessionService.stop(id);
    return this.transformSession(session);
  }

  @Get(':id/qr')
  @ApiOperation({ summary: 'Get QR code as JSON (data URL)' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'QR code data URL', type: QRCodeResponseDto })
  @ApiResponse({ status: 400, description: 'QR code not ready or session already authenticated' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async getQRCode(@Param('id') id: string): Promise<QRCodeResponseDto> {
    return this.sessionService.getQRCode(id);
  }

  @Get(':id/qr/image')
  @ApiOperation({ summary: 'Get QR code as PNG image (open in browser to scan)' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'PNG image', content: { 'image/png': {} } })
  @ApiResponse({ status: 400, description: 'QR code not ready' })
  async getQRImage(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const { qrCode } = await this.sessionService.getQRCode(id);
    const base64Data = qrCode.replace(/^data:image\/\w+;base64,/, '');
    const imgBuffer = Buffer.from(base64Data, 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', imgBuffer.length);
    res.setHeader('Cache-Control', 'no-store');
    res.end(imgBuffer);
  }

  @Get(':id/qr/scan')
  @ApiOperation({ summary: 'Open QR code in browser — auto-refreshes every 3s until authenticated' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'HTML page with scannable QR' })
  getQRScanPage(@Param('id') id: string, @Res() res: Response): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Scan QR — Session ${id}</title>
  <style>
    body { font-family: sans-serif; display:flex; flex-direction:column; align-items:center;
           justify-content:center; min-height:100vh; margin:0; background:#f0f2f5; }
    h2 { color:#25d366; margin-bottom:8px; }
    p { color:#555; margin:4px 0 20px; font-size:14px; }
    img { border:4px solid #25d366; border-radius:12px; width:280px; height:280px;
          box-shadow:0 4px 20px rgba(0,0,0,.15); }
    #status { margin-top:16px; font-size:13px; color:#888; }
  </style>
</head>
<body>
  <h2>WhatsApp QR Code</h2>
  <p>Open WhatsApp → Linked Devices → Link a Device and scan this code</p>
  <img id="qr" src="/api/sessions/${id}/qr/image?t=${Date.now()}" alt="QR Code">
  <div id="status">Auto-refreshing every 3 seconds…</div>
  <script>
    var interval = setInterval(function() {
      var img = document.getElementById('qr');
      var newSrc = '/api/sessions/${id}/qr/image?t=' + Date.now();
      var tmp = new Image();
      tmp.onload = function() { img.src = newSrc; };
      tmp.onerror = function() {
        document.getElementById('status').textContent = '✅ Session authenticated — you can close this tab.';
        clearInterval(interval);
      };
      tmp.src = newSrc;
    }, 3000);
  </script>
</body>
</html>`);
  }
}
