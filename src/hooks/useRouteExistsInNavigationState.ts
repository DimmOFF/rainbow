import { useNavigationState } from '@react-navigation/native';
import { useMemo } from 'react';

export default function useRouteExistsInNavigationState(routeName: any) {
  const routes = useNavigationState(state => state.routes);
  return useMemo(() => routes.find(route => route.name === routeName), [
    routeName,
    routes,
  ]);
}
