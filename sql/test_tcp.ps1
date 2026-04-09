# PowerShell TCP 连接测试脚本（Windows）
# 测试 PostgreSQL 和 PostgREST 端口连通性

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "TCP 连接测试" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 测试 PostgREST (3000 端口)
Write-Host "`n测试 PostgREST (端口 3000)..." -ForegroundColor Yellow
$port3000 = Test-NetConnection -ComputerName "43.139.41.82" -Port 3000 -WarningAction SilentlyContinue
if ($port3000.TcpTestSucceeded) {
    Write-Host "✓ 端口 3000 (PostgREST) 可连接" -ForegroundColor Green
} else {
    Write-Host "✗ 端口 3000 (PostgREST) 无法连接" -ForegroundColor Red
}

# 测试 PostgreSQL (5432 端口)
Write-Host "`n测试 PostgreSQL (端口 5432)..." -ForegroundColor Yellow
$port5432 = Test-NetConnection -ComputerName "43.139.41.82" -Port 5432 -WarningAction SilentlyContinue
if ($port5432.TcpTestSucceeded) {
    Write-Host "✓ 端口 5432 (PostgreSQL) 可连接" -ForegroundColor Green
} else {
    Write-Host "✗ 端口 5432 (PostgreSQL) 无法连接（可能被防火墙阻止，这是正常的）" -ForegroundColor Yellow
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "TCP 测试完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
