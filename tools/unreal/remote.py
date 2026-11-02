"""Run Python in the open Unreal Editor from a terminal, with Windows Python.

Tick Edit > Project Settings > Plugins > Python > Enable Remote Execution, then:

    python remote.py "import unreal; print(unreal.SystemLibrary.get_engine_version())"
    python remote.py "//wsl.localhost/Ubuntu/path/to/casa_setup.py" --north 0

Prints what the code printed; exits 1 if it raised.
"""
import subprocess
import sys
import time

sys.path.append(r'C:\Program Files\Epic Games\UE_5.8\Engine\Plugins\Experimental\PythonScriptPlugin\Content\Python')
import remote_execution as rx


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    # one argument is code or a script; more is a script and its options, like the editor's `py` command
    command = args[0] if len(args) == 1 and not args[0].endswith('.py') else subprocess.list2cmdline(args)
    rex = rx.RemoteExecution()
    rex.start()
    try:
        for _ in range(50):
            if rex.remote_nodes:
                break
            time.sleep(0.1)
        else:
            sys.exit('No Unreal Editor answered: is it open, with Enable Remote Execution ticked?')
        rex.open_command_connection(rex.remote_nodes[0]['node_id'])
        try:
            result = rex.run_command(command)
        except RuntimeError:  # ponytail: the engine's client gives up on replies over ~8 KB; print less or write to a file
            sys.exit("Unreal's reply was cut off: it was probably too long, print less or write it to a file")
    finally:
        rex.stop()
    sys.stdout.reconfigure(encoding='utf-8')     # piped Windows Python would write cp1252 and choke on other characters
    for line in result['output']:
        print(line['output'].rstrip('\n'))
    if not result['success']:
        sys.exit(result['result'])


if __name__ == '__main__':
    main()
