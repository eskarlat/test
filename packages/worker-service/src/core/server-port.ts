let _port = 42888;

export function setServerPort(port: number): void {
  _port = port;
}

export function getServerPort(): number {
  return _port;
}
