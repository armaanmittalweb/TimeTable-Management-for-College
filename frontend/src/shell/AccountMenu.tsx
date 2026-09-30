import { Icon } from '../ui/Icon';
import { MenuItem, Popover, usePopover } from '../ui/Menu';
import { navigate } from '../lib/router';
import { setTheme, useTheme } from '../lib/theme';
import { useSession } from '../state/session';
import { toast } from '../ui/Toast';

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

export function AccountMenu({ onShortcuts, studentLabel }: { onShortcuts: () => void; studentLabel?: string }) {
  const { me, signOut } = useSession();
  const pop = usePopover();
  const theme = useTheme();
  const name = me?.user?.name ?? (me?.demo ? 'Demo guest' : studentLabel ?? 'This device');
  const avatar = me?.user ? initials(me.user.name) : me?.demo ? 'DG' : null;

  const leave = async (demo: boolean) => {
    pop.close(false);
    await signOut();
    toast(demo ? 'You left the demo college. Its copy is deleted within a day.' : 'Signed out.');
    navigate('/');
  };

  return (
    <>
      <button
        ref={pop.anchor}
        type="button"
        className={`avatar${avatar ? '' : ' is-device'}`}
        aria-haspopup="menu"
        aria-expanded={pop.open}
        aria-label={`Account: ${name}`}
        onClick={pop.toggle}
      >
        {avatar ?? <Icon name="teacher" />}
      </button>
      <Popover open={pop.open} anchor={pop.anchor} onClose={pop.close} align="end" width={264} label="Account" role="menu">
        <div className="menu-head">
          <b>{name}</b>
          <span>{me?.user?.email ?? (me?.demo ? 'A private copy, deleted after 24 hours' : 'Batches you follow are saved on this device')}</span>
        </div>
        <div className="menu-sep" role="separator" />
        <div className="menu-group-label" aria-hidden="true">Theme</div>
        <MenuItem icon={<Icon name="monitor" />} checked={theme === 'system'} onSelect={() => setTheme('system')}>Match the system</MenuItem>
        <MenuItem icon={<Icon name="sun" />} checked={theme === 'light'} onSelect={() => setTheme('light')}>Light</MenuItem>
        <MenuItem icon={<Icon name="moon" />} checked={theme === 'dark'} onSelect={() => setTheme('dark')}>Dark</MenuItem>
        <div className="menu-sep" role="separator" />
        {me?.user && (
          <MenuItem icon={<Icon name="settings" />} onSelect={() => (pop.close(false), navigate('/settings'))}>Settings</MenuItem>
        )}
        {!me?.user && !me?.demo && (
          <MenuItem icon={<Icon name="lock" />} onSelect={() => (pop.close(false), navigate('/signin?sync=1'))}>Sign in to sync</MenuItem>
        )}
        {me?.demo && (
          <MenuItem icon={<Icon name="plus" />} onSelect={() => (pop.close(false), navigate('/signup'))}>Create an account</MenuItem>
        )}
        <MenuItem icon={<Icon name="keyboard" />} kbd="?" onSelect={() => (pop.close(false), onShortcuts())}>Keyboard shortcuts</MenuItem>
        {me?.user && (
          <MenuItem icon={<Icon name="logout" />} onSelect={() => void leave(false)}>Sign out</MenuItem>
        )}
        {me?.demo && !me.user && (
          <MenuItem icon={<Icon name="logout" />} onSelect={() => void leave(true)}>Leave the demo</MenuItem>
        )}
      </Popover>
    </>
  );
}
