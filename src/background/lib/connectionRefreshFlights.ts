export function createConnectionRefreshFlights<A>() {
  const flights = new Map<string, Promise<A>>();
  return (connectionId: string, grantIdentity: string, refresh: () => Promise<A>): Promise<A> => {
    const key = JSON.stringify([connectionId, grantIdentity]);
    const current = flights.get(key);
    if (current) return current;
    const flight = Promise.resolve().then(refresh);
    flights.set(key, flight);
    const clear = () => { if (flights.get(key) === flight) flights.delete(key); };
    void flight.then(clear, clear);
    return flight;
  };
}
