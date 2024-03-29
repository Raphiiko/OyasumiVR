$protoFiles = Get-ChildItem -Path "proto/" -Filter "*.proto"
$PROTOS_PATH = Join-Path -Path (Get-Location) -ChildPath "proto"
$OUT_PATH = Join-Path -Path (Get-Location) -ChildPath "src-grpc-web-client"
if (-not (Test-Path -Path $OUT_PATH)) {
  New-Item -ItemType Directory -Path $OUT_PATH -Force -ErrorAction SilentlyContinue
}
Get-ChildItem -Path $OUT_PATH -Filter "*.ts" | Remove-Item -Force
foreach ($file in $protoFiles) {
  $PROTO_FILE = $file.Name
  Invoke-Expression -Command "protoc --ts_out $OUT_PATH --ts_opt add_pb_suffix --ts_opt force_server_none --proto_path $PROTOS_PATH $PROTO_FILE"
}
